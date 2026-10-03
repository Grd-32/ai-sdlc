// import { PrismaClient } from "@prisma/client";

// export type OrganizationRole =
//   | "OWNER"
//   | "ADMIN"
//   | "SECURITY"
//   | "ENGINEER"
//   | "VIEWER"
//   | "AUDITOR";

// export type AIInvolvement = "YES" | "NO" | "UNKNOWN";
// export type ProvenanceSource =
//   | "DEVELOPER_DECLARED"
//   | "AGENT_TELEMETRY"
//   | "GIT_METADATA"
//   | "IDE_SIGNAL"
//   | "BEHAVIORAL_INFERENCE"
//   | "CI_SIGNAL"
//   | "UNKNOWN";
// export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
// export type PolicyAction = "ALLOW" | "REVIEW" | "BLOCK";
// export type EvidenceStatus = "PASS" | "FAIL" | "UNKNOWN" | "NOT_RUN" | "NOT_APPLICABLE";
// export type ReviewDecision = "APPROVED" | "REJECTED" | "CHANGES_REQUESTED";

// const globalForPrisma = globalThis as unknown as {
//   prisma: PrismaClient | undefined;
// };

// const ROLE_PRIORITY: Record<OrganizationRole, number> = {
//   OWNER: 6,
//   ADMIN: 5,
//   SECURITY: 4,
//   ENGINEER: 3,
//   AUDITOR: 2,
//   VIEWER: 1,
// };

// export const prisma =
//   globalForPrisma.prisma ??
//   new PrismaClient({
//     log: process.env["NODE_ENV"] === "development" ? ["warn", "error"] : ["error"],
//   });

// if (process.env["NODE_ENV"] !== "production") {
//   globalForPrisma.prisma = prisma;
// }

// export { PrismaClient };
// export type { SystemHealth } from "@prisma/client";

// export type OrganizationScope = {
//   organizationId: string;
// };

// type OrganizationMemberFindFirstResult = {
//   role: OrganizationRole;
// } | null;

// type OrganizationMemberDelegate = {
//   findFirst: (args: {
//     where: {
//       organizationId: string;
//       userId: string;
//     };
//     select: {
//       role: true;
//     };
//   }) => Promise<OrganizationMemberFindFirstResult>;
// };

// export type OrganizationAccessPrisma = {
//   organizationMember: OrganizationMemberDelegate;
// };

// export type OrganizationAccessParams = {
//   prisma: OrganizationAccessPrisma;
//   userId: string;
//   organizationId: string;
//   minimumRole?: OrganizationRole;
// };

// export function requireOrganizationId(organizationId: string): string {
//   if (!organizationId || organizationId.trim().length === 0) {
//     throw new Error("organizationId is required");
//   }
//   return organizationId;
// }

// export function buildOrganizationScope(organizationId: string): OrganizationScope {
//   return { organizationId: requireOrganizationId(organizationId) };
// }

// export async function isOrganizationMember(
//   prismaClient: OrganizationAccessPrisma,
//   userId: string,
//   organizationId: string,
// ): Promise<boolean> {
//   if (!userId || !organizationId) {
//     return false;
//   }

//   const membership = await prismaClient.organizationMember.findFirst({
//     where: {
//       organizationId: requireOrganizationId(organizationId),
//       userId,
//     },
//     select: {
//       role: true,
//     },
//   });

//   return membership !== null;
// }

// export async function ensureOrganizationAccess({
//   prisma: prismaClient,
//   userId,
//   organizationId,
//   minimumRole = "VIEWER",
// }: OrganizationAccessParams): Promise<{ organizationId: string; role: OrganizationRole }> {
//   const scopedOrganizationId = requireOrganizationId(organizationId);

//   if (!userId || userId.trim().length === 0) {
//     throw new Error("userId is required for organization access checks");
//   }

//   const membership = await prismaClient.organizationMember.findFirst({
//     where: {
//       organizationId: scopedOrganizationId,
//       userId,
//     },
//     select: {
//       role: true,
//     },
//   });

//   if (!membership) {
//     throw new Error("User is not a member of the requested organization");
//   }

//   const userRole = membership.role;
//   if (ROLE_PRIORITY[userRole] < ROLE_PRIORITY[minimumRole]) {
//     throw new Error(
//       `User does not have the required role (${minimumRole}) for organization ${scopedOrganizationId}`,
//     );
//   }

//   return {
//     organizationId: scopedOrganizationId,
//     role: userRole,
//   };
// }

// /**
//  * Verify database connectivity.
//  */
// export async function checkDatabaseConnection(): Promise<boolean> {
//   try {
//     await prisma.$queryRaw`SELECT 1`;
//     return true;
//   } catch {
//     return false;
//   }
// }
import { PrismaClient } from "@prisma/client";
import { ROLE_PRIORITY as AUTH_ROLE_PRIORITY, normalizeRole } from "./authorize.js";

export type OrganizationRole =
  | "OWNER"
  | "ADMIN"
  | "SECURITY"
  | "SECURITY_ADMIN"
  | "SECURITY_ANALYST"
  | "ENGINEER"
  | "REVIEWER"
  | "VIEWER"
  | "AUDITOR";

export type AIInvolvement = "YES" | "NO" | "UNKNOWN";
export type ProvenanceSource =
  | "DEVELOPER_DECLARED"
  | "AGENT_TELEMETRY"
  | "GIT_METADATA"
  | "IDE_SIGNAL"
  | "BEHAVIORAL_INFERENCE"
  | "CI_SIGNAL"
  | "UNKNOWN";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type PolicyAction = "ALLOW" | "REVIEW" | "BLOCK";
export type EvidenceStatus = "PASS" | "FAIL" | "UNKNOWN" | "NOT_RUN" | "NOT_APPLICABLE";
export type ReviewDecision = "APPROVED" | "REJECTED" | "CHANGES_REQUESTED";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const ROLE_PRIORITY: Record<OrganizationRole, number> = AUTH_ROLE_PRIORITY;

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env["NODE_ENV"] === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env["NODE_ENV"] !== "production") {
  globalForPrisma.prisma = prisma;
}

export { PrismaClient };
export type { SystemHealth } from "@prisma/client";

export type OrganizationScope = {
  organizationId: string;
};

type OrganizationMemberFindFirstResult = {
  role: OrganizationRole;
} | null;

type OrganizationMemberDelegate = {
  findFirst: (args: {
    where: {
      organizationId: string;
      userId: string;
    };
    select: {
      role: true;
    };
  }) => Promise<OrganizationMemberFindFirstResult>;
};

export type OrganizationAccessPrisma = {
  organizationMember: OrganizationMemberDelegate;
};

export type OrganizationAccessParams = {
  prisma: OrganizationAccessPrisma;
  userId: string;
  organizationId: string;
  minimumRole?: OrganizationRole;
};

export function requireOrganizationId(organizationId: string): string {
  if (!organizationId || organizationId.trim().length === 0) {
    throw new Error("organizationId is required");
  }
  return organizationId;
}

export function buildOrganizationScope(organizationId: string): OrganizationScope {
  return { organizationId: requireOrganizationId(organizationId) };
}

export async function isOrganizationMember(
  prismaClient: OrganizationAccessPrisma,
  userId: string,
  organizationId: string,
): Promise<boolean> {
  if (!userId || !organizationId) {
    return false;
  }

  const membership = await prismaClient.organizationMember.findFirst({
    where: {
      organizationId: requireOrganizationId(organizationId),
      userId,
    },
    select: {
      role: true,
    },
  });

  return membership !== null;
}

export async function ensureOrganizationAccess({
  prisma: prismaClient,
  userId,
  organizationId,
  minimumRole = "VIEWER",
}: OrganizationAccessParams): Promise<{ organizationId: string; role: OrganizationRole }> {
  const scopedOrganizationId = requireOrganizationId(organizationId);

  if (!userId || userId.trim().length === 0) {
    throw new Error("userId is required for organization access checks");
  }

  const membership = await prismaClient.organizationMember.findFirst({
    where: {
      organizationId: scopedOrganizationId,
      userId,
    },
    select: {
      role: true,
    },
  });

  if (!membership) {
    throw new Error("User is not a member of the requested organization");
  }

  const userRole = membership.role;
  if (ROLE_PRIORITY[normalizeRole(userRole)] < ROLE_PRIORITY[normalizeRole(minimumRole)]) {
    throw new Error(
      `User does not have the required role (${minimumRole}) for organization ${scopedOrganizationId}`,
    );
  }

  return {
    organizationId: scopedOrganizationId,
    role: userRole,
  };
}

/**
 * Verify database connectivity.
 */
export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

// Phase 14 — audit event logging (README §23/§48/§92)
export * from "./audit.js";
// Milestone A — enterprise identity & tenancy
export * from "./authorize.js";
export * from "./sessions.js";
export * from "./tenant.js";