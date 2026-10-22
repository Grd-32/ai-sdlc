import { domainToASCII } from "node:url";
import { randomBytes } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import type { Hono } from "hono";
import { prisma, recordAuditEvent } from "@ai-sdlc/db";
import { requireAuth, requireOrganizationRole } from "../middleware/auth.js";
import { readJsonObject } from "../request-body.js";
import type { AppEnv } from "../types.js";

function normalizeDomain(value: string): string | null {
  const domain = domainToASCII(value.trim().replace(/\.$/, "").toLowerCase());
  if (
    !domain ||
    domain.length > 253 ||
    domain.includes("..") ||
    domain.split(".").length < 2 ||
    domain.split(".").some((label) => !label || label.length > 63)
  ) {
    return null;
  }
  if (domain.split(".").some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    return null;
  }
  return domain;
}

export function registerOrganizationDomainRoutes(app: Hono<AppEnv>): void {
  app.get(
    "/api/organizations/:organizationId/domains",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const domains = await prisma.organizationDomain.findMany({
        where: { organizationId: c.get("organizationId") },
        orderBy: { domain: "asc" },
        select: { id: true, domain: true, verified: true, createdAt: true },
      });
      return c.json({ data: domains, error: null });
    },
  );

  app.post(
    "/api/organizations/:organizationId/domains",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const body = await readJsonObject(c);
      const domain = typeof body?.domain === "string" ? normalizeDomain(body.domain) : null;
      if (!domain) {
        return c.json(
          { data: null, error: { code: "INVALID_DOMAIN", message: "Enter a valid domain name." } },
          400,
        );
      }

      const organizationId = c.get("organizationId");
      const token = randomBytes(32).toString("base64url");
      const existing = await prisma.organizationDomain.findUnique({
        where: { organizationId_domain: { organizationId, domain } },
        select: { id: true, verified: true },
      });
      if (existing?.verified) {
        return c.json(
          {
            data: null,
            error: { code: "DOMAIN_ALREADY_VERIFIED", message: "Domain is already verified." },
          },
          409,
        );
      }

      const record = existing
        ? await prisma.organizationDomain.update({
            where: { id: existing.id },
            data: { verificationToken: token },
          })
        : await prisma.organizationDomain.create({
            data: { organizationId, domain, verificationToken: token },
          });

      return c.json(
        {
          data: {
            id: record.id,
            domain,
            verified: false,
            dnsRecord: {
              type: "TXT",
              name: `_nomalog-verification.${domain}`,
              value: `nomalog-verify=${token}`,
            },
          },
          error: null,
        },
        existing ? 200 : 201,
      );
    },
  );

  app.post(
    "/api/organizations/:organizationId/domains/:domainId/verify",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const domain = await prisma.organizationDomain.findFirst({
        where: { id: c.req.param("domainId"), organizationId },
      });
      if (!domain) {
        return c.json(
          { data: null, error: { code: "NOT_FOUND", message: "Domain not found." } },
          404,
        );
      }
      if (domain.verified) return c.json({ data: { id: domain.id, verified: true }, error: null });
      if (!domain.verificationToken) {
        return c.json(
          {
            data: null,
            error: { code: "VERIFICATION_NOT_STARTED", message: "Request a DNS challenge first." },
          },
          409,
        );
      }

      let txtRecords: string[][];
      try {
        txtRecords = await resolveTxt(`_nomalog-verification.${domain.domain}`);
      } catch (error) {
        const code =
          typeof error === "object" && error !== null && "code" in error
            ? String(error.code)
            : "DNS_LOOKUP_FAILED";
        if (code === "ENODATA" || code === "ENOTFOUND") {
          return c.json(
            {
              data: null,
              error: {
                code: "DNS_CHALLENGE_NOT_FOUND",
                message: "The DNS TXT challenge was not found. Confirm the record and try again.",
              },
            },
            409,
          );
        }
        console.error("[organization-domains] DNS verification lookup failed", { code });
        return c.json(
          {
            data: null,
            error: {
              code: "DNS_LOOKUP_FAILED",
              message: "DNS verification could not be completed; retry later.",
            },
          },
          502,
        );
      }

      const expected = `nomalog-verify=${domain.verificationToken}`;
      if (!txtRecords.flat().includes(expected)) {
        return c.json(
          {
            data: null,
            error: {
              code: "DNS_CHALLENGE_MISMATCH",
              message: "The DNS TXT value does not match the current challenge.",
            },
          },
          409,
        );
      }

      await prisma.organizationDomain.update({
        where: { id: domain.id },
        data: { verified: true, verificationToken: null },
      });
      await recordAuditEvent({
        organizationId,
        actorId: c.get("userId"),
        eventType: "ORGANIZATION_DOMAIN_VERIFIED",
        metadata: { domain: domain.domain },
      });
      return c.json({
        data: { id: domain.id, domain: domain.domain, verified: true },
        error: null,
      });
    },
  );

  app.delete(
    "/api/organizations/:organizationId/domains/:domainId",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const domain = await prisma.organizationDomain.findFirst({
        where: { id: c.req.param("domainId"), organizationId },
        select: { id: true, domain: true, verified: true },
      });
      if (!domain) {
        return c.json(
          { data: null, error: { code: "NOT_FOUND", message: "Domain not found." } },
          404,
        );
      }
      if (domain.verified) {
        const [organization, otherVerifiedDomains] = await Promise.all([
          prisma.organization.findUnique({
            where: { id: organizationId },
            select: { ssoEnforced: true },
          }),
          prisma.organizationDomain.count({
            where: { organizationId, verified: true, id: { not: domain.id } },
          }),
        ]);
        if (organization?.ssoEnforced && otherVerifiedDomains === 0) {
          return c.json(
            {
              data: null,
              error: {
                code: "SSO_DOMAIN_REQUIRED",
                message:
                  "Disable SSO enforcement or verify another domain before removing this domain.",
              },
            },
            409,
          );
        }
      }
      await prisma.organizationDomain.delete({ where: { id: domain.id } });
      await recordAuditEvent({
        organizationId,
        actorId: c.get("userId"),
        eventType: "ORGANIZATION_DOMAIN_REMOVED",
        metadata: { domain: domain.domain },
      });
      return c.json({ data: { deleted: true }, error: null });
    },
  );
}
