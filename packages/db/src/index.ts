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
import { createHash, randomBytes } from "node:crypto";
import { PrismaClient, type Prisma } from "@prisma/client";
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
export type AIApprovalStatus = "APPROVED" | "REVIEW" | "BLOCKED" | "UNREVIEWED";
export type PolicyMode = "ENFORCING" | "DRY_RUN" | "DISABLED";
export type SBOMComponentStatus = "ACTIVE" | "REVIEW" | "BLOCKED" | "ACCEPTED";
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
      scimActive: boolean;
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
      scimActive: true,
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
      scimActive: true,
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

export function normalizePolicyMode(value?: string | null): PolicyMode {
  const normalized = (value ?? "DRY_RUN").toUpperCase();
  if (normalized === "ENFORCING" || normalized === "DRY_RUN" || normalized === "DISABLED") {
    return normalized as PolicyMode;
  }
  throw new Error(`Invalid policy mode: ${value}. Expected ENFORCING, DRY_RUN, or DISABLED.`);
}

export type CreatePolicyParams = {
  prisma: PrismaClient;
  organizationId: string;
  name: string;
  description?: string | null;
  enabled?: boolean;
  mode?: PolicyMode | string;
  version?: string;
};

export async function createPolicy({
  prisma: prismaClient,
  organizationId,
  name,
  description,
  enabled = true,
  mode = "DRY_RUN",
  version = "v1",
}: CreatePolicyParams) {
  requireOrganizationId(organizationId);
  const normalizedName = name.trim();
  if (!normalizedName) {
    throw new Error("policy name is required");
  }

  return prismaClient.policy.create({
    data: {
      organizationId,
      name: normalizedName,
      description: description?.trim() || null,
      enabled,
      mode: normalizePolicyMode(mode),
      version,
    },
  });
}

export async function updatePolicyMode({
  prisma: prismaClient,
  organizationId,
  policyId,
  mode,
}: {
  prisma: PrismaClient;
  organizationId: string;
  policyId: string;
  mode: PolicyMode | string;
}) {
  requireOrganizationId(organizationId);
  if (!policyId) {
    throw new Error("policyId is required");
  }

  const existing = await prismaClient.policy.findFirst({
    where: { id: policyId, organizationId },
  });

  if (!existing) {
    throw new Error("Policy not found for the requested organization");
  }

  return prismaClient.policy.update({
    where: { id: policyId },
    data: { mode: normalizePolicyMode(mode) },
  });
}

export function generateApiKeySecret(prefix = "ai_sdlc_"): string {
  return `${prefix}${randomBytes(32).toString("hex")}`;
}

export function hashApiKeySecret(secret: string): string {
  return createHash("sha256").update(secret.trim()).digest("hex");
}

export type CreateServiceAccountParams = {
  prisma: PrismaClient;
  organizationId: string;
  name: string;
  description?: string | null;
  role?: OrganizationRole;
  active?: boolean;
};

export async function createServiceAccount({
  prisma: prismaClient,
  organizationId,
  name,
  description,
  role = "VIEWER",
  active = true,
}: CreateServiceAccountParams) {
  requireOrganizationId(organizationId);
  if (!name || name.trim().length === 0) {
    throw new Error("service account name is required");
  }

  return prismaClient.serviceAccount.create({
    data: {
      organizationId,
      name: name.trim(),
      description: description ?? null,
      role: normalizeRole(role),
      active,
    },
  });
}

export type CreateApiKeyParams = {
  prisma: PrismaClient;
  organizationId: string;
  serviceAccountId?: string | null;
  name: string;
  expiresAt?: Date | string | null;
};

export async function createApiKey({
  prisma: prismaClient,
  organizationId,
  serviceAccountId,
  name,
  expiresAt,
}: CreateApiKeyParams): Promise<{
  secret: string;
  apiKey: {
    id: string;
    organizationId: string;
    serviceAccountId?: string | null;
    name: string;
    keyHash: string;
    revokedAt: Date | null;
    expiresAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  };
}> {
  requireOrganizationId(organizationId);
  if (!name || name.trim().length === 0) {
    throw new Error("API key name is required");
  }

  const secret = generateApiKeySecret();
  const apiKey = await prismaClient.apiKey.create({
    data: {
      organizationId,
      serviceAccountId: serviceAccountId ?? undefined,
      name: name.trim(),
      keyHash: hashApiKeySecret(secret),
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    },
  });

  return {
    secret,
    apiKey,
  };
}

export type VerifyApiKeyParams = {
  prisma: PrismaClient;
  organizationId: string;
  secret: string;
};

export async function verifyApiKey({
  prisma: prismaClient,
  organizationId,
  secret,
}: VerifyApiKeyParams): Promise<boolean> {
  const keyHash = hashApiKeySecret(secret);
  const apiKey = await prismaClient.apiKey.findFirst({
    where: {
      organizationId,
      keyHash,
      revokedAt: null,
      AND: [
        {
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        {
          OR: [
            { serviceAccountId: null },
            { serviceAccount: { is: { active: true, organizationId } } },
          ],
        },
      ],
    },
    select: { id: true },
  });

  return Boolean(apiKey);
}

export async function revokeApiKey({
  prisma: prismaClient,
  organizationId,
  keyId,
}: {
  prisma: PrismaClient;
  organizationId: string;
  keyId: string;
}): Promise<boolean> {
  const result = await prismaClient.apiKey.updateMany({
    where: {
      id: keyId,
      organizationId,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  });

  return result.count > 0;
}

export function normalizeAIApprovalStatus(value?: string | null): AIApprovalStatus {
  const normalized = (value ?? "UNREVIEWED").toUpperCase();
  if (normalized === "APPROVED" || normalized === "REVIEW" || normalized === "BLOCKED") {
    return normalized as AIApprovalStatus;
  }
  return "UNREVIEWED";
}

export type RegisterAIProviderParams = {
  prisma: PrismaClient;
  organizationId: string;
  name: string;
  status?: AIApprovalStatus | string;
  website?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
};

export async function registerAIProvider({
  prisma: prismaClient,
  organizationId,
  name,
  status = "UNREVIEWED",
  website,
  description,
  metadata,
}: RegisterAIProviderParams) {
  requireOrganizationId(organizationId);
  const normalizedName = name.trim();
  if (!normalizedName) throw new Error("AI provider name is required");

  const jsonMetadata: Prisma.InputJsonValue | undefined =
    metadata == null ? undefined : (metadata as Prisma.InputJsonValue);

  return prismaClient.aIProvider.upsert({
    where: { organizationId_name: { organizationId, name: normalizedName } },
    update: {
      status: normalizeAIApprovalStatus(status),
      website: website ?? undefined,
      description: description ?? undefined,
      metadata: jsonMetadata ?? undefined,
    },
    create: {
      organizationId,
      name: normalizedName,
      status: normalizeAIApprovalStatus(status),
      website: website ?? null,
      description: description ?? null,
      metadata: jsonMetadata ?? undefined,
    },
  });
}

export type RegisterAIAgentParams = {
  prisma: PrismaClient;
  organizationId: string;
  providerId: string;
  name: string;
  status?: AIApprovalStatus | string;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
};

export async function registerAIAgent({
  prisma: prismaClient,
  organizationId,
  providerId,
  name,
  status = "UNREVIEWED",
  description,
  metadata,
}: RegisterAIAgentParams) {
  requireOrganizationId(organizationId);
  if (!providerId) throw new Error("AI providerId is required");
  const normalizedName = name.trim();
  if (!normalizedName) throw new Error("AI agent name is required");

  const jsonMetadata: Prisma.InputJsonValue | undefined =
    metadata == null ? undefined : (metadata as Prisma.InputJsonValue);

  return prismaClient.aIAgent.upsert({
    where: { organizationId_providerId_name: { organizationId, providerId, name: normalizedName } },
    update: {
      status: normalizeAIApprovalStatus(status),
      description: description ?? undefined,
      metadata: jsonMetadata ?? undefined,
    },
    create: {
      organizationId,
      providerId,
      name: normalizedName,
      status: normalizeAIApprovalStatus(status),
      description: description ?? null,
      metadata: jsonMetadata ?? undefined,
    },
  });
}

export type RegisterAIModelParams = {
  prisma: PrismaClient;
  organizationId: string;
  providerId: string;
  name: string;
  status?: AIApprovalStatus | string;
  version?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
};

export async function registerAIModel({
  prisma: prismaClient,
  organizationId,
  providerId,
  name,
  status = "UNREVIEWED",
  version,
  description,
  metadata,
}: RegisterAIModelParams) {
  requireOrganizationId(organizationId);
  if (!providerId) throw new Error("AI providerId is required");
  const normalizedName = name.trim();
  if (!normalizedName) throw new Error("AI model name is required");

  const jsonMetadata: Prisma.InputJsonValue | undefined =
    metadata == null ? undefined : (metadata as Prisma.InputJsonValue);

  return prismaClient.aIModel.upsert({
    where: { organizationId_providerId_name: { organizationId, providerId, name: normalizedName } },
    update: {
      version: version ?? undefined,
      status: normalizeAIApprovalStatus(status),
      description: description ?? undefined,
      metadata: jsonMetadata ?? undefined,
    },
    create: {
      organizationId,
      providerId,
      name: normalizedName,
      version: version ?? null,
      status: normalizeAIApprovalStatus(status),
      description: description ?? null,
      metadata: jsonMetadata ?? undefined,
    },
  });
}

export type GetAIApprovalStatusParams = {
  prisma: PrismaClient;
  organizationId: string;
  providerName?: string | null;
  agentName?: string | null;
  modelName?: string | null;
};

export async function getAIApprovalStatus({
  prisma: prismaClient,
  organizationId,
  providerName,
  agentName,
  modelName,
}: GetAIApprovalStatusParams): Promise<{
  provider: AIApprovalStatus;
  agent: AIApprovalStatus;
  model: AIApprovalStatus;
}> {
  const provider = providerName
    ? ((
        await prismaClient.aIProvider.findFirst({
          where: { organizationId, name: providerName },
          select: { status: true },
        })
      )?.status ?? "UNREVIEWED")
    : "UNREVIEWED";

  const agent = agentName
    ? ((
        await prismaClient.aIAgent.findFirst({
          where: { organizationId, name: agentName },
          select: { status: true },
        })
      )?.status ?? "UNREVIEWED")
    : "UNREVIEWED";

  const model = modelName
    ? ((
        await prismaClient.aIModel.findFirst({
          where: { organizationId, name: modelName },
          select: { status: true },
        })
      )?.status ?? "UNREVIEWED")
    : "UNREVIEWED";

  return {
    provider: normalizeAIApprovalStatus(provider),
    agent: normalizeAIApprovalStatus(agent),
    model: normalizeAIApprovalStatus(model),
  };
}

export function normalizeSBOMComponentStatus(value?: string | null): SBOMComponentStatus {
  const normalized = (value ?? "ACTIVE").toUpperCase();
  if (
    normalized === "ACTIVE" ||
    normalized === "REVIEW" ||
    normalized === "BLOCKED" ||
    normalized === "ACCEPTED"
  ) {
    return normalized as SBOMComponentStatus;
  }
  return "ACTIVE";
}

export type RegisterSBOMComponentParams = {
  prisma: PrismaClient;
  organizationId: string;
  name: string;
  version?: string | null;
  ecosystem?: string | null;
  status?: SBOMComponentStatus | string;
  source?: string | null;
  metadata?: Record<string, unknown> | null;
};

export async function registerSBOMComponent({
  prisma: prismaClient,
  organizationId,
  name,
  version,
  ecosystem = "NPM",
  status = "ACTIVE",
  source,
  metadata,
}: RegisterSBOMComponentParams) {
  requireOrganizationId(organizationId);
  const normalizedName = name.trim();
  if (!normalizedName) throw new Error("SBOM component name is required");
  const normalizedEcosystem = ecosystem?.trim() || "NPM";

  const jsonMetadata: Prisma.InputJsonValue | undefined =
    metadata == null ? undefined : (metadata as Prisma.InputJsonValue);

  const existingComponent = await prismaClient.sBOMComponent.findFirst({
    where: {
      organizationId,
      ecosystem: normalizedEcosystem,
      name: normalizedName,
      version: version ?? null,
    },
  });

  const data = {
    status: normalizeSBOMComponentStatus(status),
    source: source ?? null,
    metadata: jsonMetadata ?? undefined,
  };

  if (existingComponent) {
    return prismaClient.sBOMComponent.update({
      where: { id: existingComponent.id },
      data,
    });
  }

  return prismaClient.sBOMComponent.create({
    data: {
      organizationId,
      name: normalizedName,
      version: version ?? null,
      ecosystem: normalizedEcosystem,
      ...data,
    },
  });
}

export type RecordRiskAcceptanceParams = {
  prisma: PrismaClient;
  organizationId: string;
  componentId?: string | null;
  findingId?: string | null;
  acceptedBy?: string | null;
  reason?: string | null;
  expiresAt?: Date | string | null;
};

export async function recordRiskAcceptance({
  prisma: prismaClient,
  organizationId,
  componentId,
  findingId,
  acceptedBy,
  reason,
  expiresAt,
}: RecordRiskAcceptanceParams) {
  requireOrganizationId(organizationId);
  if (!componentId && !findingId) {
    throw new Error("either componentId or findingId is required");
  }

  const record = await prismaClient.riskAcceptance.create({
    data: {
      organizationId,
      componentId: componentId ?? undefined,
      findingId: findingId ?? undefined,
      acceptedBy: acceptedBy ?? null,
      reason: reason ?? null,
      status: "ACCEPTED",
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    },
  });

  if (componentId) {
    await prismaClient.sBOMComponent.update({
      where: { id: componentId },
      data: { status: "ACCEPTED" },
    });
  }

  return record;
}

export type RecordObservabilityEventParams = {
  prisma: PrismaClient;
  organizationId?: string | null;
  service?: string | null;
  level?: string | null;
  message: string;
  requestId?: string | null;
  correlationId?: string | null;
  metadata?: Record<string, unknown> | null;
};

export async function recordObservabilityEvent({
  prisma: prismaClient,
  organizationId,
  service,
  level = "INFO",
  message,
  requestId,
  correlationId,
  metadata,
}: RecordObservabilityEventParams) {
  const normalizedMessage = message?.trim();
  if (!normalizedMessage) {
    throw new Error("observability event message is required");
  }

  const jsonMetadata: Prisma.InputJsonValue | undefined =
    metadata == null ? undefined : (metadata as Prisma.InputJsonValue);

  return prismaClient.observabilityEvent.create({
    data: {
      organizationId: organizationId ?? null,
      service: service?.trim() || null,
      level: (level ?? "INFO").toUpperCase(),
      message: normalizedMessage,
      requestId: requestId?.trim() || null,
      correlationId: correlationId?.trim() || null,
      metadata: jsonMetadata ?? undefined,
    },
  });
}

// Phase 14 — audit event logging (README §23/§48/§92)
export * from "./audit.js";
export * from "./retention.js";
// Milestone A — enterprise identity & tenancy
export * from "./authorize.js";
export * from "./sessions.js";
export * from "./tenant.js";
