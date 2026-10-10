/**
 * Enterprise identity provider configuration (Milestone A).
 *
 * Provider-neutral OIDC/SAML configuration stored per organization.
 * Actual SSO login flows are configured here; enforcement via Organization.ssoEnforced.
 */

import type { Hono } from "hono";
import { prisma, recordAuditEvent } from "@ai-sdlc/db";
import { requireAuth, requireOrganizationRole } from "../middleware/auth.js";
import { redactSensitiveFields, redactSensitiveJsonContainer } from "../security/redaction.js";
import type { AppEnv } from "../types.js";

const VALID_TYPES = new Set(["OIDC", "SAML"]);

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
          createdAt: true,
          updatedAt: true,
        },
      });
      return c.json({ data: providers, error: null });
    },
  );

  app.post(
    "/api/organizations/:organizationId/identity-providers",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const actorId = c.get("userId");
      const body = await c.req.json().catch(() => null);

      const name = typeof body?.name === "string" ? body.name.trim() : "";
      const type = typeof body?.type === "string" ? body.type : "";
      if (!name || !VALID_TYPES.has(type)) {
        return c.json(
          {
            data: null,
            error: { code: "VALIDATION_ERROR", message: "name and type (OIDC|SAML) are required" },
          },
          400,
        );
      }

      const metadata = redactSensitiveJsonContainer(body?.metadata);
      const provider = await prisma.identityProvider.create({
        data: {
          organizationId,
          name,
          type: type as "OIDC" | "SAML",
          enabled: false,
          issuer: typeof body?.issuer === "string" ? body.issuer.trim() : undefined,
          clientId: typeof body?.clientId === "string" ? body.clientId.trim() : undefined,
          metadata,
        },
      });

      await recordAuditEvent({
        organizationId,
        eventType: "IDENTITY_PROVIDER_CREATED",
        actorId,
        metadata: { providerId: provider.id, type, name },
      });

      return c.json({ data: redactSensitiveFields(provider), error: null }, 201);
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
      const body = await c.req.json().catch(() => null);

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
      } = {};

      if (typeof body?.name === "string" && body.name.trim()) data.name = body.name.trim();
      if (typeof body?.enabled === "boolean") data.enabled = body.enabled;
      if (typeof body?.issuer === "string") data.issuer = body.issuer.trim() || null;
      if (typeof body?.clientId === "string") data.clientId = body.clientId.trim() || null;
      if (typeof body?.metadata === "object" && body.metadata) {
        data.metadata = redactSensitiveJsonContainer(body.metadata);
      }

      const provider = await prisma.identityProvider.update({ where: { id: providerId }, data });

      await recordAuditEvent({
        organizationId,
        eventType: "IDENTITY_PROVIDER_UPDATED",
        actorId,
        metadata: { providerId, changes: redactSensitiveFields(data) },
      });

      return c.json({ data: redactSensitiveFields(provider), error: null });
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
      const body = await c.req.json().catch(() => null);

      if (typeof body?.ssoEnforced !== "boolean") {
        return c.json(
          {
            data: null,
            error: { code: "VALIDATION_ERROR", message: "ssoEnforced boolean is required" },
          },
          400,
        );
      }

      if (body.ssoEnforced) {
        const verifiedDomain = await prisma.organizationDomain.findFirst({
          where: { organizationId, verified: true },
        });
        const enabledIdp = await prisma.identityProvider.findFirst({
          where: { organizationId, enabled: true },
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
        data: { ssoEnforced: body.ssoEnforced },
        select: { id: true, ssoEnforced: true },
      });

      await recordAuditEvent({
        organizationId,
        eventType: "SSO_ENFORCEMENT_UPDATED",
        actorId,
        metadata: { ssoEnforced: body.ssoEnforced },
      });

      return c.json({ data: org, error: null });
    },
  );
}
