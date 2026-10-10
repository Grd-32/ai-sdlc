/**
 * Settings-page read views. Gated above plain VIEWER since both surfaces
 * expose security-relevant information:
 * - Installations: ADMIN+ — connecting/viewing GitHub App installations is
 *   an administrative concern (matches the ADMIN gate already used on the
 *   installation setup-URL callback itself).
 * - Audit events: AUDITOR+ — README's own role list names AUDITOR
 *   specifically for this purpose; gating here at exactly that role (rather
 *   than a higher one) is the RBAC model actually being used as intended.
 */

import type { Hono } from "hono";
import { prisma, recordAuditEvent } from "@ai-sdlc/db";
import { requireAuth, requireOrganizationRole } from "../middleware/auth.js";
import type { AppEnv } from "../types.js";

export function registerSettingsRoutes(app: Hono<AppEnv>): void {
  app.get(
    "/api/organizations/:organizationId/settings/retention",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organization = await prisma.organization.findUnique({
        where: { id: c.get("organizationId") },
        select: { webhookRetentionDays: true },
      });

      if (!organization) {
        return c.json({ data: null, error: { code: "NOT_FOUND", message: "Organization not found" } }, 404);
      }

      return c.json({ data: organization, error: null });
    },
  );

  app.patch(
    "/api/organizations/:organizationId/settings/retention",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const body: unknown = await c.req.json().catch(() => null);
      if (!body || typeof body !== "object" || !("webhookRetentionDays" in body)) {
        return c.json(
          { data: null, error: { code: "INVALID_RETENTION_POLICY", message: "webhookRetentionDays is required" } },
          400,
        );
      }

      const webhookRetentionDays = body.webhookRetentionDays;
      if (
        webhookRetentionDays !== null &&
        (typeof webhookRetentionDays !== "number" || !Number.isInteger(webhookRetentionDays) || webhookRetentionDays < 1 || webhookRetentionDays > 3650)
      ) {
        return c.json(
          {
            data: null,
            error: {
              code: "INVALID_RETENTION_POLICY",
              message: "webhookRetentionDays must be null or an integer between 1 and 3650",
            },
          },
          400,
        );
      }

      const organizationId = c.get("organizationId");
      const organization = await prisma.organization.update({
        where: { id: organizationId },
        data: { webhookRetentionDays },
        select: { webhookRetentionDays: true },
      });

      await recordAuditEvent({
        organizationId,
        actorId: c.get("userId"),
        eventType: "ORGANIZATION_RETENTION_UPDATED",
        metadata: { webhookRetentionDays },
      });

      return c.json({ data: organization, error: null });
    },
  );

  app.get(
    "/api/organizations/:organizationId/installations",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");

      const installations = await prisma.gitHubInstallation.findMany({
        where: { organizationId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          githubInstallationId: true,
          accountLogin: true,
          accountType: true,
          active: true,
          createdAt: true,
        },
      });

      return c.json({ data: installations, error: null });
    },
  );

  app.get(
    "/api/organizations/:organizationId/audit-events",
    requireAuth,
    requireOrganizationRole("AUDITOR"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 200);

      const events = await prisma.auditEvent.findMany({
        where: { organizationId },
        orderBy: { createdAt: "desc" },
        take: limit,
        include: { actor: { select: { name: true, username: true, email: true } } },
      });

      return c.json({
        data: events.map((event) => ({
          id: event.id,
          eventType: event.eventType,
          actor: event.actor ? event.actor.name ?? event.actor.username ?? event.actor.email : null,
          metadata: event.metadata,
          createdAt: event.createdAt,
        })),
        error: null,
      });
    },
  );
}