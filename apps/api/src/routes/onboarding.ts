/**
 * Organization onboarding (Milestone A).
 *
 * Enables self-service org creation and member management without manual DB setup.
 */

import type { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { canManageRole, prisma, recordAuditEvent, type OrganizationRole } from "@ai-sdlc/db";
import { requireAuth, requireOrganizationRole } from "../middleware/auth.js";
import type { AppEnv } from "../types.js";

const VALID_ROLES = new Set<OrganizationRole>([
  "OWNER",
  "ADMIN",
  "SECURITY",
  "SECURITY_ADMIN",
  "SECURITY_ANALYST",
  "ENGINEER",
  "REVIEWER",
  "VIEWER",
  "AUDITOR",
]);

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base || "organization";
  let attempt = 0;
  while (attempt < 10) {
    const candidate = attempt === 0 ? slug : `${slug}-${attempt}`;
    const existing = await prisma.organization.findUnique({ where: { slug: candidate } });
    if (!existing) {
      return candidate;
    }
    attempt++;
  }
  return `${slug}-${randomBytes(4).toString("hex")}`;
}

export function registerOnboardingRoutes(app: Hono<AppEnv>): void {
  /** Create a new organization; caller becomes OWNER. */
  app.post("/api/organizations", requireAuth, async (c) => {
    const userId = c.get("userId");
    const body = await c.req.json().catch(() => null);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) {
      return c.json(
        { data: null, error: { code: "VALIDATION_ERROR", message: "name is required" } },
        400,
      );
    }

    const requestedSlug = typeof body?.slug === "string" ? slugify(body.slug) : slugify(name);
    const slug = await uniqueSlug(requestedSlug);

    const organization = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name,
          slug,
          environments: {
            create: [
              { name: "Production", slug: "production", environment: "PRODUCTION" },
              { name: "Staging", slug: "staging", environment: "STAGING" },
              { name: "Development", slug: "development", environment: "DEVELOPMENT" },
            ],
          },
        },
      });

      await tx.organizationMember.create({
        data: { organizationId: org.id, userId, role: "OWNER" },
      });

      return org;
    });

    await recordAuditEvent({
      organizationId: organization.id,
      eventType: "ORGANIZATION_CREATED",
      actorId: userId,
      metadata: { name, slug },
    });

    return c.json({ data: organization, error: null }, 201);
  });

  /** List organization members. */
  app.get(
    "/api/organizations/:organizationId/members",
    requireAuth,
    requireOrganizationRole("VIEWER"),
    async (c) => {
      const organizationId = c.get("organizationId");

      const members = await prisma.organizationMember.findMany({
        where: { organizationId, scimActive: true },
        include: {
          user: { select: { id: true, email: true, name: true, username: true, avatarUrl: true } },
        },
        orderBy: { createdAt: "asc" },
      });

      return c.json({
        data: members.map((m) => ({
          id: m.id,
          userId: m.userId,
          role: m.role,
          email: m.user.email,
          name: m.user.name,
          username: m.user.username,
          externalId: m.externalId,
        })),
        error: null,
      });
    },
  );

  /** Add or invite a member by email. */
  app.post(
    "/api/organizations/:organizationId/members",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const actorId = c.get("userId");
      const body = await c.req.json().catch(() => null);

      const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
      const roleInput = typeof body?.role === "string" ? body.role : "VIEWER";
      if (!email || !VALID_ROLES.has(roleInput as OrganizationRole)) {
        return c.json(
          {
            data: null,
            error: { code: "VALIDATION_ERROR", message: "Valid email and role are required" },
          },
          400,
        );
      }
      const role = roleInput as OrganizationRole;
      const actorRole = c.get("organizationRole");
      if (!canManageRole(actorRole, role)) {
        return c.json(
          {
            data: null,
            error: {
              code: "FORBIDDEN",
              message: "You cannot grant an organization role higher than your own",
            },
          },
          403,
        );
      }

      const user =
        (await prisma.user.findUnique({ where: { email } })) ??
        (await prisma.user.create({ data: { email, name: email.split("@")[0] ?? email } }));

      const existingMembership = await prisma.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId, userId: user.id } },
        select: { role: true },
      });
      if (existingMembership && !canManageRole(actorRole, existingMembership.role)) {
        return c.json(
          {
            data: null,
            error: { code: "FORBIDDEN", message: "You cannot manage a member with a higher role" },
          },
          403,
        );
      }

      const member = await prisma.organizationMember.upsert({
        where: { organizationId_userId: { organizationId, userId: user.id } },
        update: { role, scimActive: true },
        create: { organizationId, userId: user.id, role },
      });

      await recordAuditEvent({
        organizationId,
        eventType: "MEMBER_ADDED",
        actorId,
        metadata: { memberId: member.id, email, role },
      });

      return c.json({ data: member, error: null }, 201);
    },
  );

  /** Update member role. */
  app.patch(
    "/api/organizations/:organizationId/members/:memberId",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const actorId = c.get("userId");
      const memberId = c.req.param("memberId");
      const body = await c.req.json().catch(() => null);

      const existing = await prisma.organizationMember.findFirst({
        where: { id: memberId, organizationId },
      });
      if (!existing) {
        return c.json(
          { data: null, error: { code: "NOT_FOUND", message: "Member not found" } },
          404,
        );
      }

      const actorRole = c.get("organizationRole");
      if (!canManageRole(actorRole, existing.role)) {
        return c.json(
          {
            data: null,
            error: { code: "FORBIDDEN", message: "You cannot manage a member with a higher role" },
          },
          403,
        );
      }

      if (existing.role === "OWNER" && body?.role && body.role !== "OWNER") {
        const ownerCount = await prisma.organizationMember.count({
          where: { organizationId, role: "OWNER", scimActive: true },
        });
        if (ownerCount <= 1) {
          return c.json(
            {
              data: null,
              error: {
                code: "VALIDATION_ERROR",
                message: "Organization must retain at least one owner",
              },
            },
            400,
          );
        }
      }

      const roleInput = typeof body?.role === "string" ? body.role : existing.role;
      if (!VALID_ROLES.has(roleInput as OrganizationRole)) {
        return c.json(
          { data: null, error: { code: "VALIDATION_ERROR", message: "Invalid role" } },
          400,
        );
      }
      if (!canManageRole(actorRole, roleInput as OrganizationRole)) {
        return c.json(
          {
            data: null,
            error: {
              code: "FORBIDDEN",
              message: "You cannot grant an organization role higher than your own",
            },
          },
          403,
        );
      }

      const member = await prisma.organizationMember.update({
        where: { id: memberId },
        data: { role: roleInput as OrganizationRole },
      });

      await recordAuditEvent({
        organizationId,
        eventType: "MEMBER_ROLE_UPDATED",
        actorId,
        metadata: { memberId, previousRole: existing.role, newRole: roleInput },
      });

      return c.json({ data: member, error: null });
    },
  );

  /** Remove (deactivate) a member. */
  app.delete(
    "/api/organizations/:organizationId/members/:memberId",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const actorId = c.get("userId");
      const memberId = c.req.param("memberId");

      const existing = await prisma.organizationMember.findFirst({
        where: { id: memberId, organizationId },
      });
      if (!existing) {
        return c.json(
          { data: null, error: { code: "NOT_FOUND", message: "Member not found" } },
          404,
        );
      }

      if (!canManageRole(c.get("organizationRole"), existing.role)) {
        return c.json(
          {
            data: null,
            error: { code: "FORBIDDEN", message: "You cannot remove a member with a higher role" },
          },
          403,
        );
      }

      if (existing.role === "OWNER") {
        const ownerCount = await prisma.organizationMember.count({
          where: { organizationId, role: "OWNER", scimActive: true },
        });
        if (ownerCount <= 1) {
          return c.json(
            {
              data: null,
              error: { code: "VALIDATION_ERROR", message: "Cannot remove the last owner" },
            },
            400,
          );
        }
      }

      await prisma.organizationMember.update({
        where: { id: memberId },
        data: { scimActive: false },
      });

      await recordAuditEvent({
        organizationId,
        eventType: "MEMBER_REMOVED",
        actorId,
        metadata: { memberId, userId: existing.userId },
      });

      return c.json({ data: { removed: true }, error: null });
    },
  );

  /** Register a domain for verification (SSO enforcement prerequisite). */
  app.post(
    "/api/organizations/:organizationId/domains",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const actorId = c.get("userId");
      const body = await c.req.json().catch(() => null);
      const domain = typeof body?.domain === "string" ? body.domain.trim().toLowerCase() : "";
      if (!domain || domain.includes("@") || domain.includes(" ")) {
        return c.json(
          { data: null, error: { code: "VALIDATION_ERROR", message: "Valid domain is required" } },
          400,
        );
      }

      const verificationToken = randomBytes(16).toString("hex");
      const record = await prisma.organizationDomain.upsert({
        where: { organizationId_domain: { organizationId, domain } },
        update: { verificationToken, verified: false },
        create: { organizationId, domain, verificationToken },
      });

      await recordAuditEvent({
        organizationId,
        eventType: "DOMAIN_REGISTERED",
        actorId,
        metadata: { domain },
      });

      return c.json(
        {
          data: {
            id: record.id,
            domain: record.domain,
            verified: record.verified,
            verificationInstructions: `Add a DNS TXT record: _ai-sdlc-verify.${domain} = ${verificationToken}`,
          },
          error: null,
        },
        201,
      );
    },
  );
}
