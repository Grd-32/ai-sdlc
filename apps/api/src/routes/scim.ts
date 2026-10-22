/**
 * SCIM 2.0 provisioning (Milestone A).
 *
 * Org-scoped bearer token auth. Supports idempotent user create/update/deactivate
 * and basic group membership mapping to application roles.
 */

import { Hono, type Context, type Next } from "hono";
import { createHash, randomBytes } from "node:crypto";
import { prisma, recordAuditEvent, type OrganizationRole } from "@ai-sdlc/db";
import { resolveOrganizationEntitlements } from "@ai-sdlc/billing";
import { requireAuth, requireOrganizationRole } from "../middleware/auth.js";
import type { AppEnv } from "../types.js";
import { readJsonObject } from "../request-body.js";

const SCIM_CONTENT_TYPE = "application/scim+json";

const ROLE_MAP: Record<string, OrganizationRole> = {
  "Security-Admins": "SECURITY_ADMIN",
  SECURITY_ADMIN: "SECURITY_ADMIN",
  Developers: "ENGINEER",
  ENGINEER: "ENGINEER",
  "Senior-Engineers": "SENIOR_ENGINEER",
  SENIOR_ENGINEER: "SENIOR_ENGINEER",
  "Platform-Engineers": "PLATFORM_ENGINEER",
  PLATFORM_ENGINEER: "PLATFORM_ENGINEER",
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

async function requireScimAuth(c: Context<ScimEnv>, next: Next): Promise<Response | undefined> {
  const authHeader = c.req.header("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  const token = match?.[1]?.trim();
  if (!token) {
    return c.json(
      { schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"], detail: "Unauthorized" },
      401,
      {
        "Content-Type": SCIM_CONTENT_TYPE,
      },
    );
  }

  const tokenRecord = await prisma.scimBearerToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { organizationId: true, revokedAt: true },
  });

  if (!tokenRecord || tokenRecord.revokedAt) {
    return c.json(
      { schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"], detail: "Unauthorized" },
      401,
      {
        "Content-Type": SCIM_CONTENT_TYPE,
      },
    );
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
      const body = await readJsonObject(c);
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
    const body = await readJsonObject(c);
    const username = typeof body?.userName === "string" ? body.userName : "";
    const emails: unknown[] = Array.isArray(body?.emails) ? body.emails : [];
    const firstEmail = emails[0];
    const nestedEmail =
      firstEmail !== null &&
      typeof firstEmail === "object" &&
      "value" in firstEmail &&
      typeof firstEmail.value === "string"
        ? firstEmail.value
        : "";
    const email = (username || nestedEmail).toLowerCase().trim();
    const externalId =
      typeof body?.externalId === "string" ? body.externalId : randomBytes(8).toString("hex");
    const active = body?.active !== false;
    const name = body?.name;
    const formattedName =
      name !== null &&
      typeof name === "object" &&
      "formatted" in name &&
      typeof name.formatted === "string"
        ? name.formatted
        : "";
    const displayName =
      formattedName ||
      (typeof body?.displayName === "string" ? body.displayName : (email.split("@")[0] ?? email));

    if (!email) {
      return c.json({ detail: "userName or email is required" }, 400, {
        "Content-Type": SCIM_CONTENT_TYPE,
      });
    }

    const groupValues: unknown[] = Array.isArray(body?.groups) ? body.groups : [];
    const groups = groupValues.filter((group): group is string => typeof group === "string");
    const role = mapRoleFromGroups(groups);

    const user =
      (await prisma.user.findUnique({ where: { email } })) ??
      (await prisma.user.create({ data: { email, name: displayName, externalId } }));

    // SCIM activity is organization membership state; User.active is an
    // account-wide authentication control and must not be changed here.
    let member;
    try {
      member = await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId})) IS NULL AS locked`;
          const entitlements = await resolveOrganizationEntitlements(organizationId, tx);
          const existing = await tx.organizationMember.findUnique({
            where: { organizationId_userId: { organizationId, userId: user.id } },
            select: { scimActive: true },
          });
          if (active && !existing?.scimActive) {
            const activeMembers = await tx.organizationMember.count({
              where: { organizationId, scimActive: true, user: { active: true } },
            });
            if (activeMembers >= entitlements.entitlements.maxTeamMembers) {
              throw new Error("TEAM_MEMBER_LIMIT_REACHED");
            }
          }
          return tx.organizationMember.upsert({
            where: { organizationId_userId: { organizationId, userId: user.id } },
            update: {
              externalId,
              scimActive: active,
              role: active ? role : "VIEWER",
              scimManagedRole: active,
            },
            create: {
              organizationId,
              userId: user.id,
              externalId,
              scimActive: active,
              role,
              scimManagedRole: active,
            },
            include: { user: { select: { email: true, name: true } } },
          });
        },
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      if (error instanceof Error && error.message === "TEAM_MEMBER_LIMIT_REACHED") {
        return c.json(
          {
            schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
            status: "409",
            detail: "The organization member limit for its active plan has been reached.",
          },
          409,
          { "Content-Type": SCIM_CONTENT_TYPE },
        );
      }
      throw error;
    }

    if (!active) {
      await prisma.organizationMember.update({
        where: { id: member.id },
        data: { scimActive: false },
      });
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
    const body = await readJsonObject(c);

    const member = await prisma.organizationMember.findFirst({
      where: { organizationId, externalId },
      include: { user: true },
    });
    if (!member) {
      return c.json({ detail: "User not found" }, 404, { "Content-Type": SCIM_CONTENT_TYPE });
    }

    let active = member.scimActive;
    const operations: unknown[] = Array.isArray(body?.Operations) ? body.Operations : [];
    for (const value of operations) {
      if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
      const operation = value as Record<string, unknown>;
      const operationName =
        typeof operation["op"] === "string" ? operation["op"].toLowerCase() : "";
      if (operationName === "replace" && operation["path"] === "active") {
        active = operation["value"] === true;
      }
    }

    const updated = await prisma.organizationMember.update({
      where: { id: member.id },
      data: { scimActive: active },
      include: { user: { select: { email: true, name: true } } },
    });

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

    const member = await prisma.organizationMember.findFirst({
      where: { organizationId, externalId },
    });
    if (!member) {
      return c.json({ detail: "User not found" }, 404, { "Content-Type": SCIM_CONTENT_TYPE });
    }

    await prisma.organizationMember.update({
      where: { id: member.id },
      data: { scimActive: false },
    });

    await recordAuditEvent({
      organizationId,
      eventType: "SCIM_USER_DEACTIVATED",
      metadata: { externalId },
    });

    return c.body(null, 204);
  });

  const groupMembers = {
    include: {
      members: {
        include: {
          member: { include: { user: { select: { email: true, name: true } } } },
        },
      },
    },
  } as const;
  const toScimGroup = (group: {
    id: string;
    externalId: string;
    displayName: string;
    members: Array<{
      member: {
        id: string;
        externalId: string | null;
        user: { email: string; name: string | null };
      };
    }>;
  }) => ({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
    id: group.externalId,
    externalId: group.externalId,
    displayName: group.displayName,
    members: group.members.map(({ member }) => ({
      value: member.externalId ?? member.id,
      display: member.user.name ?? member.user.email,
      type: "User",
    })),
  });
  const parseMemberValues = (value: unknown): string[] => {
    const entries: unknown[] = Array.isArray(value)
      ? value
      : value === undefined
        ? []
        : [value];
    return entries.flatMap((entry) => {
      if (typeof entry === "string") return [entry];
      if (typeof entry === "object" && entry !== null && "value" in entry) {
        const memberValue = entry.value;
        if (typeof memberValue === "string") return [memberValue];
      }
      return [];
    });
  };
  const refreshScimManagedRoles = async (
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    memberIds: string[],
  ) => {
    for (const memberId of [...new Set(memberIds)]) {
      const member = await tx.organizationMember.findUnique({
        where: { id: memberId },
        select: {
          scimManagedRole: true,
          scimGroups: { select: { group: { select: { role: true } } } },
        },
      });
      if (!member || (!member.scimManagedRole && member.scimGroups.length === 0)) continue;
      const roles = member.scimGroups.map(({ group }) => group.role);
      const rolePriority: Record<OrganizationRole, number> = {
        OWNER: 100,
        ADMIN: 90,
        SECURITY_ADMIN: 80,
        SECURITY: 75,
        SECURITY_ANALYST: 65,
        SENIOR_ENGINEER: 70,
        PLATFORM_ENGINEER: 70,
        ENGINEER: 60,
        REVIEWER: 50,
        AUDITOR: 20,
        VIEWER: 10,
      };
      const role = roles.sort((left, right) => rolePriority[right] - rolePriority[left])[0] ?? "VIEWER";
      await tx.organizationMember.update({
        where: { id: memberId },
        data: { role, scimManagedRole: roles.length > 0 },
      });
    }
  };

  scim.get("/Groups", async (c) => {
    const organizationId = c.get("scimOrganizationId");
    const filter = c.req.query("filter");
    const displayNameMatch = filter?.match(/^displayName\s+eq\s+"([^"]+)"$/i);
    if (filter && !displayNameMatch) {
      return c.json({ detail: "Only displayName eq filters are supported" }, 400);
    }
    const groups = await prisma.scimGroup.findMany({
      where: {
        organizationId,
        ...(displayNameMatch ? { displayName: displayNameMatch[1] } : {}),
      },
      ...groupMembers,
      orderBy: { displayName: "asc" },
    });
    return c.json(
      {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
        totalResults: groups.length,
        Resources: groups.map(toScimGroup),
      },
      200,
      { "Content-Type": SCIM_CONTENT_TYPE },
    );
  });

  scim.get("/Groups/:id", async (c) => {
    const group = await prisma.scimGroup.findUnique({
      where: {
        organizationId_externalId: {
          organizationId: c.get("scimOrganizationId"),
          externalId: c.req.param("id"),
        },
      },
      ...groupMembers,
    });
    if (!group) return c.json({ detail: "Group not found" }, 404);
    return c.json(toScimGroup(group), 200, { "Content-Type": SCIM_CONTENT_TYPE });
  });

  scim.post("/Groups", async (c) => {
    const organizationId = c.get("scimOrganizationId");
    const body = await readJsonObject(c);
    const displayName =
      typeof body?.["displayName"] === "string" ? body["displayName"].trim() : "";
    const externalId =
      typeof body?.["externalId"] === "string" && body["externalId"].trim()
        ? body["externalId"].trim()
        : randomBytes(16).toString("hex");
    if (!displayName) return c.json({ detail: "displayName is required" }, 400);
    const duplicate = await prisma.scimGroup.findUnique({
      where: { organizationId_externalId: { organizationId, externalId } },
      select: { id: true },
    });
    if (duplicate) return c.json({ detail: "Group externalId already exists" }, 409);
    if (
      body?.["members"] !== undefined &&
      parseMemberValues(body["members"]).length !==
        (Array.isArray(body["members"]) ? body["members"].length : 1)
    ) {
      return c.json({ detail: "Invalid group member value" }, 400);
    }
    const values = parseMemberValues(body?.["members"]);
    const memberships = values.length
      ? await prisma.organizationMember.findMany({
          where: {
            organizationId,
            scimActive: true,
            OR: [{ externalId: { in: values } }, { id: { in: values } }],
          },
          select: { id: true },
        })
      : [];
    if (memberships.length !== new Set(values).size && values.length > 0) {
      return c.json({ detail: "One or more group members do not exist in this organization" }, 400);
    }
    const role = mapRoleFromGroups([displayName]);
    const group = await prisma.$transaction(async (tx) => {
      const created = await tx.scimGroup.create({
        data: { organizationId, externalId, displayName, role },
      });
      if (memberships.length) {
        await tx.scimGroupMember.createMany({
          data: memberships.map((member) => ({ groupId: created.id, memberId: member.id })),
          skipDuplicates: true,
        });
        await tx.organizationMember.updateMany({
          where: { id: { in: memberships.map(({ id }) => id) } },
          data: { role, scimManagedRole: true },
        });
      }
      return tx.scimGroup.findUniqueOrThrow({
        where: { id: created.id },
        ...groupMembers,
      });
    });
    await recordAuditEvent({
      organizationId,
      eventType: "MEMBER_ADDED",
      metadata: { scimGroupId: group.id, operation: "created" },
    });
    return c.json(toScimGroup(group), 201, { "Content-Type": SCIM_CONTENT_TYPE });
  });

  scim.put("/Groups/:id", async (c) => {
    const organizationId = c.get("scimOrganizationId");
    const group = await prisma.scimGroup.findUnique({
      where: {
        organizationId_externalId: {
          organizationId,
          externalId: c.req.param("id"),
        },
      },
      ...groupMembers,
    });
    if (!group) return c.json({ detail: "Group not found" }, 404);
    const body = await readJsonObject(c);
    const displayName =
      typeof body?.["displayName"] === "string" ? body["displayName"].trim() : "";
    if (!displayName) return c.json({ detail: "displayName is required" }, 400);
    const memberValue = body?.["members"];
    if (
      memberValue !== undefined &&
      parseMemberValues(memberValue).length !==
        (Array.isArray(memberValue) ? memberValue.length : 1)
    ) {
      return c.json({ detail: "Invalid group member value" }, 400);
    }
    const values = parseMemberValues(memberValue);
    const memberships = values.length
      ? await prisma.organizationMember.findMany({
          where: {
            organizationId,
            scimActive: true,
            OR: [{ externalId: { in: values } }, { id: { in: values } }],
          },
          select: { id: true },
        })
      : [];
    if (memberships.length !== new Set(values).size) {
      return c.json({ detail: "One or more group members do not exist in this organization" }, 400);
    }
    const affectedMemberIds = new Set([
      ...group.members.map(({ member }) => member.id),
      ...memberships.map(({ id }) => id),
    ]);
    const updatedGroup = await prisma.$transaction(async (tx) => {
      const updated = await tx.scimGroup.update({
        where: { id: group.id },
        data: { displayName, role: mapRoleFromGroups([displayName]) },
      });
      await tx.scimGroupMember.deleteMany({ where: { groupId: group.id } });
      if (memberships.length) {
        await tx.scimGroupMember.createMany({
          data: memberships.map(({ id }) => ({ groupId: group.id, memberId: id })),
          skipDuplicates: true,
        });
      }
      await refreshScimManagedRoles(tx, [...affectedMemberIds]);
      return tx.scimGroup.findUniqueOrThrow({
        where: { id: updated.id },
        ...groupMembers,
      });
    });
    await recordAuditEvent({
      organizationId,
      eventType: "MEMBER_ADDED",
      metadata: { scimGroupId: group.id, operation: "replaced" },
    });
    return c.json(toScimGroup(updatedGroup), 200, { "Content-Type": SCIM_CONTENT_TYPE });
  });

  scim.patch("/Groups/:id", async (c) => {
    const organizationId = c.get("scimOrganizationId");
    const group = await prisma.scimGroup.findUnique({
      where: {
        organizationId_externalId: {
          organizationId,
          externalId: c.req.param("id"),
        },
      },
      ...groupMembers,
    });
    if (!group) return c.json({ detail: "Group not found" }, 404);
    const body = await readJsonObject(c);
    const operations = Array.isArray(body?.["Operations"])
      ? body["Operations"].filter(
          (operation): operation is Record<string, unknown> =>
            typeof operation === "object" && operation !== null,
        )
      : [];
    const affectedMemberIds = new Set(group.members.map(({ member }) => member.id));
    let displayName = group.displayName;
    let replaceMembers: string[] | null = null;
    const additions: string[] = [];
    const removals: string[] = [];
    let removeAllMembers = false;
    for (const operation of operations) {
      const op =
        typeof operation["op"] === "string" ? operation["op"].toLowerCase() : "";
      const path =
        typeof operation["path"] === "string" ? operation["path"].toLowerCase() : "";
      if (path === "displayname" && (op === "replace" || op === "add")) {
        if (typeof operation["value"] !== "string" || !operation["value"].trim()) {
          return c.json({ detail: "displayName must be a non-empty string" }, 400);
        }
        displayName = operation["value"].trim();
      } else if (path === "members" && op === "replace") {
        replaceMembers = parseMemberValues(operation["value"]);
      } else if (path === "members" && op === "add") {
        additions.push(...parseMemberValues(operation["value"]));
      } else if (path === "members" && op === "remove") {
        const pathMember = operation["path"]?.toString().match(
          /^members\[value\s+eq\s+"([^"]+)"\]$/i,
        );
        const pathMemberId = pathMember?.[1];
        if (pathMemberId) {
          removals.push(pathMemberId);
        } else if (operation["value"] === undefined) {
          removeAllMembers = true;
        } else {
          removals.push(...parseMemberValues(operation["value"]));
        }
      } else {
        return c.json({ detail: `Unsupported group operation: ${path || op}` }, 400);
      }
    }
    const valuesToAdd = [...new Set([...(replaceMembers ?? []), ...additions])];
    const requestedIds = new Set(valuesToAdd);
    const membersToAdd = valuesToAdd.length
      ? await prisma.organizationMember.findMany({
          where: {
            organizationId,
            scimActive: true,
            OR: [
              { externalId: { in: valuesToAdd } },
              { id: { in: valuesToAdd } },
            ],
          },
          select: { id: true },
        })
      : [];
    if (membersToAdd.length !== requestedIds.size) {
      return c.json({ detail: "One or more group members do not exist in this organization" }, 400);
    }
    const removalIds = removals.length
      ? await prisma.organizationMember.findMany({
          where: {
            organizationId,
            OR: [{ externalId: { in: removals } }, { id: { in: removals } }],
          },
          select: { id: true },
        })
      : [];
    const membersForReplacement = replaceMembers === null
      ? null
      : membersToAdd.map(({ id }) => id);
    for (const { id } of removalIds) affectedMemberIds.add(id);
    for (const { id } of membersToAdd) affectedMemberIds.add(id);
    const updatedGroup = await prisma.$transaction(async (tx) => {
      const updated = await tx.scimGroup.update({
        where: { id: group.id },
        data: { displayName, role: mapRoleFromGroups([displayName]) },
      });
      if (membersForReplacement !== null) {
        await tx.scimGroupMember.deleteMany({ where: { groupId: group.id } });
      } else if (removeAllMembers) {
        await tx.scimGroupMember.deleteMany({ where: { groupId: group.id } });
      } else if (removalIds.length) {
        await tx.scimGroupMember.deleteMany({
          where: { groupId: group.id, memberId: { in: removalIds.map(({ id }) => id) } },
        });
      }
      const idsToCreate =
        membersForReplacement ??
        membersToAdd.map(({ id }) => id);
      if (idsToCreate.length) {
        await tx.scimGroupMember.createMany({
          data: idsToCreate.map((memberId) => ({ groupId: group.id, memberId })),
          skipDuplicates: true,
        });
      }
      await refreshScimManagedRoles(tx, [...affectedMemberIds]);
      return tx.scimGroup.findUniqueOrThrow({
        where: { id: updated.id },
        ...groupMembers,
      });
    });
    await recordAuditEvent({
      organizationId,
      eventType: "MEMBER_ADDED",
      metadata: { scimGroupId: group.id, operation: "updated" },
    });
    return c.json(toScimGroup(updatedGroup), 200, { "Content-Type": SCIM_CONTENT_TYPE });
  });

  scim.delete("/Groups/:id", async (c) => {
    const organizationId = c.get("scimOrganizationId");
    const group = await prisma.scimGroup.findUnique({
      where: {
        organizationId_externalId: {
          organizationId,
          externalId: c.req.param("id"),
        },
      },
      select: { id: true, members: { select: { memberId: true } } },
    });
    if (!group) return c.body(null, 404);
    await prisma.$transaction(async (tx) => {
      await tx.scimGroup.delete({ where: { id: group.id } });
      await refreshScimManagedRoles(
        tx,
        group.members.map(({ memberId }) => memberId),
      );
    });
    await recordAuditEvent({
      organizationId,
      eventType: "MEMBER_REMOVED",
      metadata: { scimGroupId: group.id, operation: "deleted" },
    });
    return c.body(null, 204);
  });

  app.route("/scim/v2", scim);
}
