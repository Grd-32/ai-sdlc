/**
 * Organization onboarding (Milestone A).
 *
 * Enables self-service org creation and member management without manual DB setup.
 */

import type { Hono } from "hono";
import { createHash, randomBytes } from "node:crypto";
import { canManageRole, prisma, recordAuditEvent, type OrganizationRole } from "@ai-sdlc/db";
import { resolveOrganizationEntitlements } from "@ai-sdlc/billing";
import { requireAuth, requireOrganizationRole } from "../middleware/auth.js";
import type { AppEnv } from "../types.js";
import { readJsonObject } from "../request-body.js";
import { createUserNotification } from "../notifications.js";

const VALID_ROLES = new Set<OrganizationRole>([
  "OWNER",
  "ADMIN",
  "SECURITY",
  "SECURITY_ADMIN",
  "SECURITY_ANALYST",
  "ENGINEER",
  "SENIOR_ENGINEER",
  "PLATFORM_ENGINEER",
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
  const slug = base || "organization";
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
  const invitationRoles: OrganizationRole[] = [
    "VIEWER",
    "AUDITOR",
    "ENGINEER",
    "SENIOR_ENGINEER",
    "PLATFORM_ENGINEER",
    "SECURITY_ADMIN",
  ];

  app.post(
    "/api/organizations/:organizationId/member-invitations",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const body = await readJsonObject(c);
      const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
      const roleInput = typeof body?.role === "string" ? body.role : "VIEWER";
      const role = invitationRoles.find((candidate) => candidate === roleInput);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return c.json(
          { data: null, error: { code: "INVALID_EMAIL", message: "A valid email is required." } },
          400,
        );
      }
      if (!role || !canManageRole(c.get("organizationRole"), role)) {
        return c.json(
          {
            data: null,
            error: { code: "ROLE_NOT_ALLOWED", message: "That role cannot be invited." },
          },
          403,
        );
      }
      const organization = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { name: true },
      });
      if (!organization) {
        return c.json(
          { data: null, error: { code: "NOT_FOUND", message: "Organization not found." } },
          404,
        );
      }
      const existingMember = await prisma.organizationMember.findFirst({
        where: { organizationId, user: { email } },
        select: { id: true, scimActive: true },
      });
      if (existingMember?.scimActive) {
        return c.json(
          {
            data: null,
            error: { code: "ALREADY_A_MEMBER", message: "That user is already a member." },
          },
          409,
        );
      }
      const user = await prisma.user.upsert({
        where: { email },
        update: {},
        create: { email },
        select: { id: true },
      });
      const token = randomBytes(32).toString("base64url");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const invitation = await prisma.$transaction(async (tx) => {
        await tx.organizationInvitation.updateMany({
          where: { organizationId, email, acceptedAt: null, revokedAt: null },
          data: { revokedAt: now },
        });
        return tx.organizationInvitation.create({
          data: {
            organizationId,
            email,
            role,
            tokenHash,
            createdById: c.get("userId"),
            expiresAt,
          },
          select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
        });
      });
      await createUserNotification({
        organizationId,
        userId: user.id,
        invitationId: invitation.id,
        type: "ORGANIZATION_INVITATION_CREATED",
        title: `Invitation to ${organization.name}`,
        body: `Sign in with this email address to accept the invitation as ${role}.`,
        href: `/invitations/accept?token=${encodeURIComponent(token)}`,
        dedupeKey: `organization-invitation-${invitation.id}`,
      });
      await recordAuditEvent({
        organizationId,
        actorId: c.get("userId"),
        eventType: "MEMBER_ADDED",
        metadata: { invitationId: invitation.id, invitedEmail: email, role },
      });
      return c.json({ data: { ...invitation, status: "PENDING" }, error: null }, 201);
    },
  );

  app.post(
    "/api/organizations/:organizationId/member-invitations/:invitationId/resend",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const invitation = await prisma.organizationInvitation.findFirst({
        where: {
          id: c.req.param("invitationId"),
          organizationId,
          acceptedAt: null,
          revokedAt: null,
        },
        include: { organization: { select: { name: true } } },
      });
      if (!invitation) {
        return c.json(
          {
            data: null,
            error: { code: "INVITATION_NOT_ACTIVE", message: "Invitation is not active." },
          },
          404,
        );
      }
      const token = randomBytes(32).toString("base64url");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await prisma.organizationInvitation.update({
        where: { id: invitation.id },
        data: { tokenHash, expiresAt },
      });
      const user = await prisma.user.findUnique({
        where: { email: invitation.email },
        select: { id: true },
      });
      if (!user) throw new Error("Invitation recipient account is missing.");
      await createUserNotification({
        organizationId,
        userId: user.id,
        invitationId: invitation.id,
        type: "ORGANIZATION_INVITATION_CREATED",
        title: `Invitation to ${invitation.organization.name}`,
        body: `Sign in with this email address to accept the invitation as ${invitation.role}.`,
        href: `/invitations/accept?token=${encodeURIComponent(token)}`,
        dedupeKey: `organization-invitation-${invitation.id}-resend-${Date.now()}`,
      });
      return c.json({ data: { id: invitation.id, expiresAt }, error: null });
    },
  );

  app.delete(
    "/api/organizations/:organizationId/member-invitations/:invitationId",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const result = await prisma.organizationInvitation.updateMany({
        where: {
          id: c.req.param("invitationId"),
          organizationId: c.get("organizationId"),
          acceptedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
      if (result.count !== 1) {
        return c.json(
          {
            data: null,
            error: { code: "INVITATION_NOT_ACTIVE", message: "Invitation is not active." },
          },
          404,
        );
      }
      await recordAuditEvent({
        organizationId: c.get("organizationId"),
        actorId: c.get("userId"),
        eventType: "MEMBER_REMOVED",
        metadata: { invitationId: c.req.param("invitationId"), invitationRevoked: true },
      });
      return c.body(null, 204);
    },
  );

  app.post("/api/invitations/accept", requireAuth, async (c) => {
    const body = await readJsonObject(c);
    const token = typeof body?.["token"] === "string" ? body["token"] : "";
    if (!token) {
      return c.json(
        {
          data: null,
          error: { code: "INVITATION_TOKEN_REQUIRED", message: "Invitation token is required." },
        },
        400,
      );
    }
    const userId = c.get("userId");
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user) {
      return c.json({ data: null, error: { code: "NOT_FOUND", message: "User not found." } }, 404);
    }
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const invitation = await prisma.organizationInvitation.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        organizationId: true,
        email: true,
        role: true,
        expiresAt: true,
        acceptedAt: true,
        revokedAt: true,
      },
    });
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.revokedAt ||
      invitation.email !== user.email.toLowerCase() ||
      invitation.expiresAt <= new Date()
    ) {
      return c.json(
        {
          data: null,
          error: {
            code:
              invitation && invitation.email !== user.email.toLowerCase()
                ? "INVITATION_EMAIL_MISMATCH"
                : "INVITATION_NOT_ACTIVE",
            message: "Invitation is invalid, expired, or belongs to another email address.",
          },
        },
        invitation && invitation.email !== user.email.toLowerCase() ? 403 : 404,
      );
    }
    const role = invitationRoles.find((candidate) => candidate === invitation.role);
    if (!role) {
      throw new Error("Invitation contains an unsupported role.");
    }
    const acceptedAt = new Date();
    const membership = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${invitation.organizationId})) IS NULL AS locked`;
      const existing = await tx.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: invitation.organizationId,
            userId,
          },
        },
        select: { id: true, scimActive: true },
      });
      if (!existing || !existing.scimActive) {
        const entitlements = await resolveOrganizationEntitlements(invitation.organizationId, tx);
        const activeMembers = await tx.organizationMember.count({
          where: {
            organizationId: invitation.organizationId,
            scimActive: true,
            user: { active: true },
          },
        });
        if (activeMembers >= entitlements.entitlements.maxTeamMembers) {
          return { limitReached: true as const };
        }
      }
      const updated = await tx.organizationInvitation.updateMany({
        where: {
          id: invitation.id,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: acceptedAt },
        },
        data: { acceptedAt, acceptedById: userId },
      });
      if (updated.count !== 1) return { inactive: true as const };
      const member = await tx.organizationMember.upsert({
        where: {
          organizationId_userId: { organizationId: invitation.organizationId, userId },
        },
        update: { role, scimActive: true },
        create: { organizationId: invitation.organizationId, userId, role },
      });
      return { member };
    });
    if ("limitReached" in membership) {
      return c.json(
        {
          data: null,
          error: {
            code: "TEAM_MEMBER_LIMIT_REACHED",
            message: "The organization has reached its member limit.",
          },
        },
        403,
      );
    }
    if ("inactive" in membership) {
      return c.json(
        {
          data: null,
          error: { code: "INVITATION_NOT_ACTIVE", message: "Invitation is no longer active." },
        },
        409,
      );
    }
    await recordAuditEvent({
      organizationId: invitation.organizationId,
      actorId: userId,
      eventType: "MEMBER_ADDED",
      metadata: { invitationId: invitation.id, role },
    });
    return c.json(
      {
        data: { organizationId: invitation.organizationId, role: membership.member.role },
        error: null,
      },
      200,
    );
  });

  /** Create a new organization; caller becomes OWNER. */
  app.post("/api/organizations", requireAuth, async (c) => {
    const userId = c.get("userId");
    const body = await readJsonObject(c);
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
        where: { organizationId },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
              username: true,
              avatarUrl: true,
              active: true,
              sessions: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
            },
          },
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
          active: m.scimActive && m.user.active,
          lastLoginAt: m.user.sessions[0]?.createdAt ?? null,
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
      const body = await readJsonObject(c);

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

      let member;
      try {
        member = await prisma.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId})) IS NULL AS locked`;
            const entitlements = await resolveOrganizationEntitlements(organizationId, tx);
            const existing = await tx.organizationMember.findUnique({
              where: { organizationId_userId: { organizationId, userId: user.id } },
              select: { id: true },
            });
            if (!existing) {
              const activeMembers = await tx.organizationMember.count({
                where: { organizationId, scimActive: true, user: { active: true } },
              });
              if (activeMembers >= entitlements.entitlements.maxTeamMembers) {
                throw new Error("TEAM_MEMBER_LIMIT_REACHED");
              }
            }
            return tx.organizationMember.upsert({
              where: { organizationId_userId: { organizationId, userId: user.id } },
              update: { role, scimActive: true },
              create: { organizationId, userId: user.id, role },
            });
          },
          { isolationLevel: "Serializable" },
        );
      } catch (error) {
        if (error instanceof Error && error.message === "TEAM_MEMBER_LIMIT_REACHED") {
          return c.json(
            {
              data: null,
              error: {
                code: "TEAM_MEMBER_LIMIT_REACHED",
                message: "The team member limit for this organization’s plan has been reached.",
              },
            },
            403,
          );
        }
        throw error;
      }

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
      const body = await readJsonObject(c);

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

      const requestedActive = typeof body?.active === "boolean" ? body.active : existing.scimActive;
      if (
        existing.role === "OWNER" &&
        (!requestedActive || (body?.role && body.role !== "OWNER"))
      ) {
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
      if (typeof body?.role !== "string" && typeof body?.active !== "boolean") {
        return c.json(
          {
            data: null,
            error: { code: "VALIDATION_ERROR", message: "role or active is required" },
          },
          400,
        );
      }
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
        data: { role: roleInput as OrganizationRole, scimActive: requestedActive },
      });

      await recordAuditEvent({
        organizationId,
        eventType:
          existing.scimActive !== requestedActive
            ? requestedActive
              ? "MEMBER_REACTIVATED"
              : "MEMBER_REMOVED"
            : "MEMBER_ROLE_UPDATED",
        actorId,
        metadata: {
          memberId,
          previousRole: existing.role,
          newRole: roleInput,
          active: requestedActive,
        },
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
      const body = await readJsonObject(c);
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
