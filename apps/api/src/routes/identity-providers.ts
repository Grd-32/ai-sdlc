/**
 * Enterprise identity provider configuration (Milestone A).
 *
 * Provider-neutral OIDC/SAML configuration stored per organization.
 * Actual SSO login flows are configured here; enforcement via Organization.ssoEnforced.
 */

import type { Hono } from "hono";
import { X509Certificate } from "node:crypto";
import { prisma, recordAuditEvent } from "@ai-sdlc/db";
import { requireAuth, requireOrganizationRole } from "../middleware/auth.js";
import { redactSensitiveFields, redactSensitiveJsonContainer } from "../security/redaction.js";
import type { AppEnv } from "../types.js";
import { readJsonObject } from "../request-body.js";
import { encryptSsoSecret } from "../auth/sso-secrets.js";

const VALID_TYPES = new Set(["OIDC", "SAML"]);

function configurationError(type: string, body: Record<string, unknown>) {
  if (type === "OIDC") {
    const issuer = typeof body["issuer"] === "string" ? body["issuer"].trim() : "";
    const clientId = typeof body["clientId"] === "string" ? body["clientId"].trim() : "";
    const secret = typeof body["clientSecret"] === "string" ? body["clientSecret"] : "";
    if (!issuer || !clientId || !secret) {
      return "OIDC requires an issuer URL, client ID, and client secret.";
    }
    try {
      const url = new URL(issuer);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
        return "OIDC issuer must be a public HTTPS URL without credentials or query parameters.";
      }
    } catch {
      return "OIDC issuer must be a valid HTTPS URL.";
    }
    return null;
  }
  const metadata = body["metadata"];
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return "SAML requires an identity-provider entry point and signing certificate.";
  }
  const values = metadata as Record<string, unknown>;
  const entryPoint = typeof values["entryPoint"] === "string" ? values["entryPoint"].trim() : "";
  const idpIssuer =
    typeof values["idpIssuer"] === "string"
      ? values["idpIssuer"].trim()
      : typeof body["issuer"] === "string"
        ? body["issuer"].trim()
        : "";
  const idpCertificate =
    typeof values["idpCertificate"] === "string" ? values["idpCertificate"].trim() : "";
  if (
    !entryPoint ||
    !idpIssuer ||
    !idpCertificate
  ) {
    return "SAML requires entryPoint, idpIssuer, and idpCertificate configuration.";
  }
  try {
    const url = new URL(entryPoint);
    if (url.protocol !== "https:" || url.username || url.password) {
      return "SAML entryPoint must use HTTPS.";
    }
  } catch {
    return "SAML entryPoint must be a valid HTTPS URL.";
  }
  try {
    new X509Certificate(idpCertificate);
  } catch {
    return "SAML idpCertificate must be a valid X.509 signing certificate.";
  }
  return null;
}

export function registerIdentityProviderRoutes(app: Hono<AppEnv>): void {
  app.get(
    "/api/organizations/:organizationId/identity-providers",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const providers = await prisma.identityProvider.findMany({
        where: { organizationId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          type: true,
          name: true,
          enabled: true,
          issuer: true,
          clientId: true,
          clientSecretEncrypted: true,
          ssoTestedAt: true,
          metadata: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      return c.json({
        data: providers.map(({ clientSecretEncrypted, ...provider }) => ({
          ...provider,
          secretConfigured: Boolean(clientSecretEncrypted),
        })),
        error: null,
      });
    },
  );

  app.post(
    "/api/organizations/:organizationId/identity-providers",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const actorId = c.get("userId");
      const body = await readJsonObject(c);

      const name = typeof body?.["name"] === "string" ? body["name"].trim() : "";
      const type = typeof body?.["type"] === "string" ? body["type"] : "";
      if (!name || !VALID_TYPES.has(type)) {
        return c.json(
          {
            data: null,
            error: { code: "VALIDATION_ERROR", message: "name and type (OIDC|SAML) are required" },
          },
          400,
        );
      }

      const invalidConfiguration = configurationError(type, body ?? {});
      if (invalidConfiguration) {
        return c.json(
          { data: null, error: { code: "INVALID_IDP_CONFIGURATION", message: invalidConfiguration } },
          400,
        );
      }
      let encryptedSecret: string | null = null;
      if (type === "OIDC" && typeof body?.["clientSecret"] === "string") {
        try {
          encryptedSecret = encryptSsoSecret(body["clientSecret"]);
        } catch (error) {
          console.error("[identity-providers] could not encrypt OIDC client secret", error);
          return c.json(
            {
              data: null,
              error: {
                code: "SSO_ENCRYPTION_NOT_CONFIGURED",
                message: "SSO secret encryption is not configured.",
              },
            },
            503,
          );
        }
      }
      const metadata = redactSensitiveJsonContainer(body?.["metadata"]);
      const provider = await prisma.identityProvider.create({
        data: {
          organizationId,
          name,
          type: type === "OIDC" ? "OIDC" : "SAML",
          enabled: true,
          issuer: typeof body?.["issuer"] === "string" ? body["issuer"].trim() : undefined,
          clientId: typeof body?.["clientId"] === "string" ? body["clientId"].trim() : undefined,
          clientSecretEncrypted: encryptedSecret,
          metadata,
        },
      });

      await recordAuditEvent({
        organizationId,
        eventType: "IDENTITY_PROVIDER_CREATED",
        actorId,
        metadata: { providerId: provider.id, type, name },
      });

      const { clientSecretEncrypted: _secret, ...safeProvider } = provider;
      return c.json(
        { data: { ...safeProvider, secretConfigured: Boolean(_secret) }, error: null },
        201,
      );
    },
  );

  app.patch(
    "/api/organizations/:organizationId/identity-providers/:providerId",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const actorId = c.get("userId");
      const providerId = c.req.param("providerId");
      const body = await readJsonObject(c);

      const existing = await prisma.identityProvider.findFirst({
        where: { id: providerId, organizationId },
      });
      if (!existing) {
        return c.json(
          { data: null, error: { code: "NOT_FOUND", message: "Identity provider not found" } },
          404,
        );
      }

      const data: {
        name?: string;
        enabled?: boolean;
        issuer?: string | null;
        clientId?: string | null;
        metadata?: object;
        clientSecretEncrypted?: string;
        ssoTestedAt?: null;
      } = {};

      if (typeof body?.["name"] === "string" && body["name"].trim()) data.name = body["name"].trim();
      if (typeof body?.["issuer"] === "string") data.issuer = body["issuer"].trim() || null;
      if (typeof body?.["clientId"] === "string") data.clientId = body["clientId"].trim() || null;
      if (typeof body?.["clientSecret"] === "string" && body["clientSecret"]) {
        try {
          data.clientSecretEncrypted = encryptSsoSecret(body["clientSecret"]);
        } catch (error) {
          console.error("[identity-providers] could not encrypt OIDC client secret", error);
          return c.json(
            {
              data: null,
              error: {
                code: "SSO_ENCRYPTION_NOT_CONFIGURED",
                message: "SSO secret encryption is not configured.",
              },
            },
            503,
          );
        }
      }
      if (typeof body?.["metadata"] === "object" && body["metadata"]) {
        data.metadata = redactSensitiveJsonContainer(body["metadata"]);
      }

      const candidate = {
        issuer: data.issuer ?? existing.issuer ?? "",
        clientId: data.clientId ?? existing.clientId ?? "",
        clientSecret:
          typeof body?.["clientSecret"] === "string" && body["clientSecret"]
            ? body["clientSecret"]
            : existing.clientSecretEncrypted
              ? "configured"
              : "",
        metadata: data.metadata ?? existing.metadata,
      };
      if (body?.["enabled"] === true) {
        const invalidConfiguration = configurationError(existing.type, candidate);
        if (invalidConfiguration) {
          return c.json(
            {
              data: null,
              error: { code: "INVALID_IDP_CONFIGURATION", message: invalidConfiguration },
            },
            400,
          );
        }
        data.enabled = true;
      } else if (body?.["enabled"] === false) {
        data.enabled = false;
      }

      if (Object.keys(data).some((key) => key !== "name" && key !== "enabled")) {
        data.ssoTestedAt = null;
      }
      const provider = await prisma.identityProvider.update({ where: { id: providerId }, data });

      await recordAuditEvent({
        organizationId,
        eventType: "IDENTITY_PROVIDER_UPDATED",
        actorId,
        metadata: { providerId, changes: redactSensitiveFields(data) },
      });

      const { clientSecretEncrypted: _secret, ...safeProvider } = provider;
      return c.json(
        { data: { ...safeProvider, secretConfigured: Boolean(_secret) }, error: null },
      );
    },
  );

  app.delete(
    "/api/organizations/:organizationId/identity-providers/:providerId",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const actorId = c.get("userId");
      const providerId = c.req.param("providerId");

      const existing = await prisma.identityProvider.findFirst({
        where: { id: providerId, organizationId },
      });
      if (!existing) {
        return c.json(
          { data: null, error: { code: "NOT_FOUND", message: "Identity provider not found" } },
          404,
        );
      }

      await prisma.identityProvider.delete({ where: { id: providerId } });

      await recordAuditEvent({
        organizationId,
        eventType: "IDENTITY_PROVIDER_DELETED",
        actorId,
        metadata: { providerId, name: existing.name },
      });

      return c.json({ data: { deleted: true }, error: null });
    },
  );

  /** Toggle SSO enforcement for the organization. */
  app.patch(
    "/api/organizations/:organizationId/sso-settings",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const actorId = c.get("userId");
      const body = await readJsonObject(c);

      if (typeof body?.["ssoEnforced"] !== "boolean") {
        return c.json(
          {
            data: null,
            error: { code: "VALIDATION_ERROR", message: "ssoEnforced boolean is required" },
          },
          400,
        );
      }

      if (body["ssoEnforced"]) {
        const verifiedDomain = await prisma.organizationDomain.findFirst({
          where: { organizationId, verified: true },
        });
        const enabledIdp = await prisma.identityProvider.findFirst({
          where: { organizationId, enabled: true, ssoTestedAt: { not: null } },
        });
        if (!verifiedDomain || !enabledIdp) {
          return c.json(
            {
              data: null,
              error: {
                code: "SSO_NOT_READY",
                message:
                  "SSO enforcement requires a verified domain and an enabled identity provider",
              },
            },
            400,
          );
        }
      }

      const org = await prisma.organization.update({
        where: { id: organizationId },
        data: { ssoEnforced: body["ssoEnforced"] },
        select: { id: true, ssoEnforced: true },
      });

      await recordAuditEvent({
        organizationId,
        eventType: "SSO_ENFORCEMENT_UPDATED",
        actorId,
        metadata: { ssoEnforced: body["ssoEnforced"] },
      });

      return c.json({ data: org, error: null });
    },
  );
}
