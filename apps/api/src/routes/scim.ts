/**
 * SCIM 2.0 provisioning (Milestone A).
 *
 * Org-scoped bearer token auth. Supports idempotent user create/update/deactivate
 * and basic group membership mapping to application roles.
 */

import type { Context, Next } from "hono";
import { createHash, randomBytes } from "node:crypto";
import type { Hono } from "hono";
import { prisma, recordAuditEvent, type OrganizationRole } from "@ai-sdlc/db";
import { requireAuth, requireOrganizationRole } from "../middleware/auth.js";
import type { AppEnv } from "../types.js";

const SCIM_CONTENT_TYPE = "application/scim+json";

const ROLE_MAP: Record<string, OrganizationRole> = {
  "Security-Admins": "SECURITY_ADMIN",
  SECURITY_ADMIN: "SECURITY_ADMIN",
  Developers: "ENGINEER",
  ENGINEER: "ENGINEER",
  Auditors: "AUDITOR",
  AUDITOR: "AUDITOR",
  "Read-Only": "VIEWER",
  VIEWER: "VIEWER",
  ADMIN: "ADMIN",
};

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

type ScimEnv = {
  Variables: {
    scimOrganizationId: string;
  };
};

async function requireScimAuth(c: Context<ScimEnv>, next: Next): Promise<Response | void> {
  const authHeader = c.req.header("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  const token = match?.[1]?.trim();
  if (!token) {
    return c.json({ schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"], detail: "Unauthorized" }, 401, {
      "Content-Type": SCIM_CONTENT_TYPE,
    });
  }

  const tokenRecord = await prisma.scimBearerToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { organizationId: true, revokedAt: true },
  });

  if (!tokenRecord || tokenRecord.revokedAt) {
    return c.json({ schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"], detail: "Unauthorized" }, 401, {
      "Content-Type": SCIM_CONTENT_TYPE,
    });
  }

  c.set("scimOrganizationId", tokenRecord.organizationId);
  await prisma.scimBearerToken.updateMany({
    where: { tokenHash: hashToken(token) },
    data: { lastUsedAt: new Date() },
  });
  await next();
}

function mapRoleFromGroups(groups: string[] | undefined): OrganizationRole {
  if (!groups || groups.length === 0) {
    return "VIEWER";
  }
  for (const group of groups) {
    const mapped = ROLE_MAP[group];
    if (mapped) {
      return mapped;
    }
  }
  return "VIEWER";
}

function toScimUser(member: {
  id: string;
  externalId: string | null;
  scimActive: boolean;
  role: OrganizationRole;
  user: { email: string; name: string | null };
}) {
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    id: member.externalId ?? member.id,
    externalId: member.externalId ?? member.id,
    userName: member.user.email,
    name: { formatted: member.user.name ?? member.user.email },
    emails: [{ value: member.user.email, primary: true }],
    active: member.scimActive,
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
      role: member.role,
    },
  };
}

export function registerScimRoutes(app: Hono<AppEnv>): void {
  /** Admin: create SCIM bearer token (secret shown once). */
  app.post(
    "/api/organizations/:organizationId/scim-tokens",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const actorId = c.get("userId");
      const body = await c.req.json().catch(() => null);
      const name = typeof body?.name === "string" ? body.name.trim() : "SCIM Token";
      const token = `scim_${randomBytes(32).toString("base64url")}`;

      const record = await prisma.scimBearerToken.create({
        data: { organizationId, name, tokenHash: hashToken(token) },
        select: { id: true, name: true, createdAt: true },
      });

      await recordAuditEvent({
        organizationId,
        eventType: "SCIM_TOKEN_CREATED",
        actorId,
        metadata: { tokenId: record.id, name },
      });

      return c.json({ data: { ...record, token }, error: null }, 201);
    },
  );

  const scim = new Hono<ScimEnv>();
  scim.use("*", requireScimAuth);

  scim.get("/Users", async (c) => {
    const organizationId = c.get("scimOrganizationId");
    const filter = c.req.query("filter") ?? "";

    let emailFilter: string | undefined;
    const eqMatch = /userName eq "([^"]+)"/i.exec(filter);
    if (eqMatch?.[1]) {
      emailFilter = eqMatch[1].toLowerCase();
    }

    const members = await prisma.organizationMember.findMany({
      where: {
        organizationId,
        ...(emailFilter ? { user: { email: emailFilter } } : {}),
      },
      include: { user: { select: { email: true, name: true } } },
    });

    return c.json(
      {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
        totalResults: members.length,
        Resources: members.map(toScimUser),
      },
      200,
      { "Content-Type": SCIM_CONTENT_TYPE },
    );
  });

  scim.post("/Users", async (c) => {
    const organizationId = c.get("scimOrganizationId");
    const body = await c.req.json().catch(() => null);
    const email = (body?.userName ?? body?.emails?.[0]?.value ?? "").toLowerCase().trim();
    const externalId = typeof body?.externalId === "string" ? body.externalId : randomBytes(8).toString("hex");
    const active = body?.active !== false;
    const displayName = body?.name?.formatted ?? body?.displayName ?? email.split("@")[0];

    if (!email) {
      return c.json({ detail: "userName or email is required" }, 400, { "Content-Type": SCIM_CONTENT_TYPE });
    }

    const role = mapRoleFromGroups(body?.groups);

    const user =
      (await prisma.user.findUnique({ where: { email } })) ??
      (await prisma.user.create({ data: { email, name: displayName, externalId } }));

    const member = await prisma.organizationMember.upsert({
      where: { organizationId_userId: { organizationId, userId: user.id } },
      update: { externalId, scimActive: active, role: active ? role : "VIEWER" },
      create: { organizationId, userId: user.id, externalId, scimActive: active, role },
      include: { user: { select: { email: true, name: true } } },
    });

    if (!active) {
      await prisma.organizationMember.update({
        where: { id: member.id },
        data: { scimActive: false },
      });
      await prisma.user.update({ where: { id: user.id }, data: { active: false } });
    }

    await recordAuditEvent({
      organizationId,
      eventType: active ? "SCIM_USER_PROVISIONED" : "SCIM_USER_DEACTIVATED",
      metadata: { externalId, email, role },
    });

    return c.json(toScimUser(member), 201, { "Content-Type": SCIM_CONTENT_TYPE });
  });

  scim.patch("/Users/:id", async (c) => {
    const organizationId = c.get("scimOrganizationId");
    const externalId = c.req.param("id");
    const body = await c.req.json().catch(() => null);

    const member = await prisma.organizationMember.findFirst({
      where: { organizationId, externalId },
      include: { user: true },
    });
    if (!member) {
      return c.json({ detail: "User not found" }, 404, { "Content-Type": SCIM_CONTENT_TYPE });
    }

    let active = member.scimActive;
    for (const op of body?.Operations ?? []) {
      if (op.op?.toLowerCase() === "replace" && op.path === "active") {
        active = op.value === true;
      }
    }

    const updated = await prisma.organizationMember.update({
      where: { id: member.id },
      data: { scimActive: active },
      include: { user: { select: { email: true, name: true } } },
    });

    await prisma.user.update({ where: { id: member.userId }, data: { active } });

    await recordAuditEvent({
      organizationId,
      eventType: active ? "SCIM_USER_REACTIVATED" : "SCIM_USER_DEACTIVATED",
      metadata: { externalId },
    });

    return c.json(toScimUser(updated), 200, { "Content-Type": SCIM_CONTENT_TYPE });
  });

  scim.delete("/Users/:id", async (c) => {
    const organizationId = c.get("scimOrganizationId");
    const externalId = c.req.param("id");

    const member = await prisma.organizationMember.findFirst({ where: { organizationId, externalId } });
    if (!member) {
      return c.json({ detail: "User not found" }, 404, { "Content-Type": SCIM_CONTENT_TYPE });
    }

    await prisma.organizationMember.update({ where: { id: member.id }, data: { scimActive: false } });
    await prisma.user.update({ where: { id: member.userId }, data: { active: false } });

    await recordAuditEvent({
      organizationId,
      eventType: "SCIM_USER_DEACTIVATED",
      metadata: { externalId },
    });

    return c.body(null, 204);
  });

  app.route("/scim/v2", scim);
}
