import { prisma, type PrismaClient } from "@ai-sdlc/db";

export type CommercialPlan = "FREE_ASSESSMENT" | "PROFESSIONAL" | "ENTERPRISE";
export type BillingSubscriptionStatus =
  "INCOMPLETE" | "ACTIVE" | "TRIALING" | "PAST_DUE" | "UNPAID" | "CANCELED" | "INACTIVE";

export interface PlanEntitlements {
  maxRepositories: number;
  assessmentsPerMonth: number;
  analysisJobsPerMonth: number;
  continuousAnalysis: boolean;
  policyEnforcement: boolean;
  retentionDays: number;
  dataExport: boolean;
  maxTeamMembers: number;
  enterpriseIntegrations: boolean;
}

export interface PlanOffer {
  id: CommercialPlan;
  name: string;
  description: string;
  displayPrice: string;
  interval: "none" | "month" | "year" | "custom";
  stripePriceId: string | null;
  selfServeCheckout: boolean;
  entitlements: PlanEntitlements;
}

function positiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("Billing plan limits must be non-negative safe integers.");
  }
  return parsed;
}

export function getPlanCatalog(): PlanOffer[] {
  const configuredInterval = process.env["PLAN_PROFESSIONAL_INTERVAL"];
  if (configuredInterval && configuredInterval !== "month" && configuredInterval !== "year") {
    throw new Error("PLAN_PROFESSIONAL_INTERVAL must be 'month' or 'year'.");
  }
  return [
    {
      id: "FREE_ASSESSMENT",
      name: process.env["PLAN_FREE_NAME"] ?? "Free Assessment",
      description:
        process.env["PLAN_FREE_DESCRIPTION"] ??
        "A scoped repository risk assessment; continuous monitoring is not included.",
      displayPrice: process.env["PLAN_FREE_DISPLAY_PRICE"] ?? "Free",
      interval: "none",
      stripePriceId: null,
      selfServeCheckout: false,
      entitlements: {
        maxRepositories: positiveInt(process.env["FREE_MAX_REPOSITORIES"], 10),
        assessmentsPerMonth: positiveInt(process.env["FREE_ASSESSMENTS_PER_MONTH"], 1),
        analysisJobsPerMonth: 0,
        continuousAnalysis: false,
        policyEnforcement: false,
        retentionDays: positiveInt(process.env["FREE_RETENTION_DAYS"], 90),
        dataExport: true,
        maxTeamMembers: positiveInt(process.env["FREE_MAX_TEAM_MEMBERS"], 5),
        enterpriseIntegrations: false,
      },
    },
    {
      id: "PROFESSIONAL",
      name: process.env["PLAN_PROFESSIONAL_NAME"] ?? "Professional",
      description:
        process.env["PLAN_PROFESSIONAL_DESCRIPTION"] ??
        "Continuous security and governance for growing engineering teams.",
      displayPrice: process.env["PLAN_PROFESSIONAL_DISPLAY_PRICE"] ?? "Contact for pricing",
      interval: configuredInterval === "year" ? "year" : "month",
      stripePriceId: process.env["STRIPE_PRICE_PROFESSIONAL"] ?? null,
      selfServeCheckout: Boolean(
        process.env["STRIPE_SECRET_KEY"] && process.env["STRIPE_PRICE_PROFESSIONAL"],
      ),
      entitlements: {
        maxRepositories: positiveInt(process.env["PROFESSIONAL_MAX_REPOSITORIES"], 25),
        assessmentsPerMonth: positiveInt(process.env["PROFESSIONAL_ASSESSMENTS_PER_MONTH"], 10),
        analysisJobsPerMonth: positiveInt(
          process.env["PROFESSIONAL_ANALYSIS_JOBS_PER_MONTH"],
          1000,
        ),
        continuousAnalysis: true,
        policyEnforcement: true,
        retentionDays: positiveInt(process.env["PROFESSIONAL_RETENTION_DAYS"], 90),
        dataExport: true,
        maxTeamMembers: positiveInt(process.env["PROFESSIONAL_MAX_TEAM_MEMBERS"], 25),
        enterpriseIntegrations: false,
      },
    },
    {
      id: "ENTERPRISE",
      name: process.env["PLAN_ENTERPRISE_NAME"] ?? "Enterprise",
      description:
        process.env["PLAN_ENTERPRISE_DESCRIPTION"] ??
        "Agreement-based entitlements provisioned by an authorized administrator.",
      displayPrice: process.env["PLAN_ENTERPRISE_DISPLAY_PRICE"] ?? "Custom agreement",
      interval: "custom",
      stripePriceId: null,
      selfServeCheckout: false,
      entitlements: {
        maxRepositories: positiveInt(process.env["ENTERPRISE_DEFAULT_MAX_REPOSITORIES"], 100),
        assessmentsPerMonth: positiveInt(
          process.env["ENTERPRISE_DEFAULT_ASSESSMENTS_PER_MONTH"],
          100,
        ),
        analysisJobsPerMonth: positiveInt(
          process.env["ENTERPRISE_DEFAULT_ANALYSIS_JOBS_PER_MONTH"],
          10000,
        ),
        continuousAnalysis: true,
        policyEnforcement: true,
        retentionDays: positiveInt(process.env["ENTERPRISE_DEFAULT_RETENTION_DAYS"], 365),
        dataExport: true,
        maxTeamMembers: positiveInt(process.env["ENTERPRISE_DEFAULT_MAX_TEAM_MEMBERS"], 100),
        enterpriseIntegrations: false,
      },
    },
  ];
}

export interface OrganizationEntitlements {
  plan: CommercialPlan;
  status: BillingSubscriptionStatus | "FREE" | "EXPIRED";
  effectivePlan: CommercialPlan;
  entitlements: PlanEntitlements;
  billingAccessOnly: boolean;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  subscription: {
    cancelAtPeriodEnd: boolean;
    latestInvoiceStatus: string | null;
    agreementName: string | null;
  } | null;
}

const usageTypes = ["ASSESSMENT_ATTEMPT", "ASSESSMENT_COMPLETED", "ANALYSIS_JOB"] as const;
export type UsageType = (typeof usageTypes)[number];
export type UsageMetadataValue =
  string | number | boolean | null | UsageMetadata | UsageMetadataValue[];
export interface UsageMetadata {
  [key: string]: UsageMetadataValue;
}

function usageLimit(entitlements: OrganizationEntitlements, type: UsageType): number {
  if (type === "ASSESSMENT_ATTEMPT") return entitlements.entitlements.assessmentsPerMonth;
  if (type === "ANALYSIS_JOB") return entitlements.entitlements.analysisJobsPerMonth;
  return Number.MAX_SAFE_INTEGER;
}

export async function reserveUsage(
  organizationId: string,
  type: UsageType,
  idempotencyKey: string,
  metadata?: UsageMetadata,
  db: PrismaClient = prisma,
): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId}))`;
          const entitlements = await resolveOrganizationEntitlements(organizationId, tx);
          if (
            type === "ANALYSIS_JOB" &&
            (!entitlements.entitlements.continuousAnalysis || entitlements.billingAccessOnly)
          ) {
            return false;
          }
          const existing = await tx.usageRecord.findUnique({
            where: { organizationId_idempotencyKey: { organizationId, idempotencyKey } },
            select: { id: true },
          });
          if (existing) return true;

          if (type !== "ASSESSMENT_COMPLETED") {
            const used = await tx.usageRecord.aggregate({
              where: {
                organizationId,
                type,
                createdAt: {
                  gte: entitlements.currentPeriodStart,
                  lt: entitlements.currentPeriodEnd,
                },
              },
              _sum: { quantity: true },
            });
            if ((used._sum.quantity ?? 0) + 1 > usageLimit(entitlements, type)) return false;
          }

          await tx.usageRecord.create({
            data: {
              organizationId,
              type,
              quantity: 1,
              idempotencyKey,
              periodStart: entitlements.currentPeriodStart,
              periodEnd: entitlements.currentPeriodEnd,
              metadata: metadata,
            },
          });
          return true;
        },
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      if (code === "P2002") return true;
      if (code !== "P2034" || attempt === 2) throw error;
    }
  }
  return false;
}

export async function resolveOrganizationEntitlements(
  organizationId: string,
  db: Pick<PrismaClient, "billingSubscription"> = prisma,
  now = new Date(),
): Promise<OrganizationEntitlements> {
  const subscription = await db.billingSubscription.findUnique({ where: { organizationId } });
  const catalog = getPlanCatalog();
  const free = catalog.find((plan) => plan.id === "FREE_ASSESSMENT");
  if (!free) throw new Error("Free assessment plan is not configured.");
  const fallbackPeriodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const fallbackPeriodEnd = now;

  if (!subscription || subscription.plan === "FREE_ASSESSMENT") {
    return {
      plan: "FREE_ASSESSMENT",
      effectivePlan: "FREE_ASSESSMENT",
      status: "FREE",
      entitlements: free.entitlements,
      billingAccessOnly: false,
      currentPeriodStart: fallbackPeriodStart,
      currentPeriodEnd: fallbackPeriodEnd,
      subscription: null,
    };
  }

  const paidStatus =
    (subscription.status === "ACTIVE" || subscription.status === "TRIALING") &&
    (!subscription.currentPeriodEnd || subscription.currentPeriodEnd > now);
  const expired =
    (subscription.status === "ACTIVE" || subscription.status === "TRIALING") &&
    Boolean(subscription.currentPeriodEnd && subscription.currentPeriodEnd <= now);
  const effectivePlan = paidStatus ? subscription.plan : "FREE_ASSESSMENT";
  const planOffer = catalog.find((offer) => offer.id === effectivePlan) ?? free;
  const savedEntitlements =
    paidStatus &&
    typeof subscription.entitlements === "object" &&
    subscription.entitlements !== null &&
    !Array.isArray(subscription.entitlements)
      ? (subscription.entitlements as Partial<PlanEntitlements>)
      : {};

  return {
    plan: subscription.plan,
    effectivePlan,
    status: expired ? "EXPIRED" : subscription.status,
    entitlements: { ...planOffer.entitlements, ...savedEntitlements },
    billingAccessOnly: !paidStatus,
    currentPeriodStart: paidStatus
      ? (subscription.currentPeriodStart ?? fallbackPeriodStart)
      : fallbackPeriodStart,
    currentPeriodEnd: paidStatus
      ? (subscription.currentPeriodEnd ?? fallbackPeriodEnd)
      : fallbackPeriodEnd,
    subscription: {
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      latestInvoiceStatus: subscription.latestInvoiceStatus,
      agreementName: subscription.agreementName,
    },
  };
}

export async function readUsage(
  organizationId: string,
  entitlements: OrganizationEntitlements,
  db: PrismaClient = prisma,
): Promise<Record<UsageType, number>> {
  const grouped = await db.usageRecord.groupBy({
    by: ["type"],
    where: {
      organizationId,
      type: { in: [...usageTypes] },
      createdAt: { gte: entitlements.currentPeriodStart, lte: entitlements.currentPeriodEnd },
    },
    _sum: { quantity: true },
  });
  const usage: Record<UsageType, number> = {
    ASSESSMENT_ATTEMPT: 0,
    ASSESSMENT_COMPLETED: 0,
    ANALYSIS_JOB: 0,
  };
  for (const item of grouped) usage[item.type] = item._sum.quantity ?? 0;
  return usage;
}

export function entitlementAllowsPaidUsage(
  entitlements: OrganizationEntitlements,
  usageType: UsageType,
): boolean {
  if (entitlements.billingAccessOnly) return usageType === "ASSESSMENT_ATTEMPT";
  if (usageType === "ANALYSIS_JOB") return entitlements.entitlements.continuousAnalysis;
  return true;
}
