import { describe, expect, it, vi } from "vitest";
import {
  getPlanCatalog,
  reserveUsage,
  resolveOrganizationEntitlements,
  type PlanEntitlements,
} from "./index.js";

describe("billing plan catalogue", () => {
  it("exposes configured free, professional, and enterprise offers", () => {
    const ids = getPlanCatalog().map((plan) => plan.id);
    expect(ids).toEqual(["FREE_ASSESSMENT", "PROFESSIONAL", "ENTERPRISE"]);
    expect(getPlanCatalog()[0]?.entitlements.continuousAnalysis).toBe(false);
  });

  it("does not grant paid entitlements after a past-due subscription", async () => {
    const db = {
      billingSubscription: {
        findUnique: vi.fn().mockResolvedValue({
          plan: "PROFESSIONAL",
          status: "PAST_DUE",
          entitlements: null,
          currentPeriodStart: null,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          latestInvoiceStatus: "open",
          agreementName: null,
        }),
      },
    };
    const result = await resolveOrganizationEntitlements(
      "org",
      db as never,
      new Date("2026-01-15T00:00:00Z"),
    );
    expect(result.effectivePlan).toBe("FREE_ASSESSMENT");
    expect(result.billingAccessOnly).toBe(true);
    expect(result.currentPeriodStart).toEqual(new Date("2025-12-16T00:00:00Z"));
    expect(result.currentPeriodEnd).toEqual(new Date("2026-01-15T00:00:00Z"));
  });

  it("preserves paid entitlements while cancellation is scheduled for period end", async () => {
    const entitlements: PlanEntitlements = {
      maxRepositories: 5,
      assessmentsPerMonth: 2,
      analysisJobsPerMonth: 20,
      continuousAnalysis: true,
      policyEnforcement: true,
      retentionDays: 30,
      dataExport: true,
      maxTeamMembers: 4,
      enterpriseIntegrations: false,
    };
    const db = {
      billingSubscription: {
        findUnique: vi.fn().mockResolvedValue({
          plan: "PROFESSIONAL",
          status: "ACTIVE",
          entitlements,
          currentPeriodStart: null,
          currentPeriodEnd: new Date("2026-02-01T00:00:00Z"),
          cancelAtPeriodEnd: true,
          latestInvoiceStatus: "paid",
          agreementName: null,
        }),
      },
    };
    const result = await resolveOrganizationEntitlements(
      "org",
      db as never,
      new Date("2026-01-15T00:00:00Z"),
    );
    expect(result.effectivePlan).toBe("PROFESSIONAL");
    expect(result.entitlements).toEqual(entitlements);
  });

  it("serializes quota reservation, counts the quota, and writes an idempotent usage key", async () => {
    const tx = {
      $executeRaw: vi.fn(),
      billingSubscription: { findUnique: vi.fn().mockResolvedValue(null) },
      usageRecord: {
        findUnique: vi.fn().mockResolvedValue(null),
        aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: 0 } }),
        create: vi.fn().mockResolvedValue({ id: "usage" }),
      },
    };
    const db = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    const reserved = await reserveUsage(
      "org",
      "ASSESSMENT_ATTEMPT",
      "assessment-attempt-key",
      undefined,
      db as never,
    );
    expect(reserved).toBe(true);
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
    expect(tx.usageRecord.create.mock.calls[0]?.[0]).toMatchObject({
      data: { idempotencyKey: "assessment-attempt-key" },
    });
  });

  it("rejects quota overage and treats an existing idempotency key as already reserved", async () => {
    const tx = {
      $executeRaw: vi.fn(),
      billingSubscription: { findUnique: vi.fn().mockResolvedValue(null) },
      usageRecord: {
        findUnique: vi.fn().mockResolvedValue(null),
        aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: 1 } }),
        create: vi.fn(),
      },
    };
    const db = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    expect(
      await reserveUsage("org", "ASSESSMENT_ATTEMPT", "over-quota", undefined, db as never),
    ).toBe(false);
    tx.usageRecord.findUnique.mockResolvedValue({ id: "existing" });
    expect(
      await reserveUsage("org", "ASSESSMENT_ATTEMPT", "existing-key", undefined, db as never),
    ).toBe(true);
    expect(tx.usageRecord.create).not.toHaveBeenCalled();
  });

  it("rechecks the persisted plan under the quota lock before reserving paid analysis", async () => {
    const tx = {
      $executeRaw: vi.fn(),
      billingSubscription: {
        findUnique: vi.fn().mockResolvedValue({
          plan: "PROFESSIONAL",
          status: "PAST_DUE",
          entitlements: null,
          currentPeriodStart: new Date("2026-01-01T00:00:00Z"),
          currentPeriodEnd: new Date("2026-02-01T00:00:00Z"),
          cancelAtPeriodEnd: false,
          latestInvoiceStatus: "open",
          agreementName: null,
        }),
      },
      usageRecord: {
        findUnique: vi.fn().mockResolvedValue(null),
        aggregate: vi.fn(),
        create: vi.fn(),
      },
    };
    const db = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };

    await expect(
      reserveUsage("org", "ANALYSIS_JOB", "analysis-job", undefined, db as never),
    ).resolves.toBe(false);
    expect(tx.usageRecord.create).not.toHaveBeenCalled();
  });
});
