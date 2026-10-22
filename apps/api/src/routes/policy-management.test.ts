import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../types.js";

const mocks = vi.hoisted(() => ({
  policyFindMany: vi.fn(),
  policyCreate: vi.fn(),
  policyFindFirst: vi.fn(),
  policyRuleCreate: vi.fn(),
  policyRuleFindFirst: vi.fn(),
  policyUpdate: vi.fn(),
  policyRevisionCreate: vi.fn(),
  policyRevisionFindFirst: vi.fn(),
  policyApprovalCreateMany: vi.fn(),
  approvalStatuses: vi.fn(),
  pullRequestFindMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@ai-sdlc/db", () => ({
  prisma: {
    policy: {
      findMany: mocks.policyFindMany,
      create: mocks.policyCreate,
      findFirst: mocks.policyFindFirst,
    },
    policyRule: {
      create: mocks.policyRuleCreate,
      findFirst: mocks.policyRuleFindFirst,
    },
    pullRequest: { findMany: mocks.pullRequestFindMany },
    policyRevision: {
      create: mocks.policyRevisionCreate,
      findFirst: mocks.policyRevisionFindFirst,
    },
    policyApproval: { createMany: mocks.policyApprovalCreateMany },
    $transaction: mocks.transaction,
  },
  getPolicyEnforcementApprovalStatuses: mocks.approvalStatuses,
  Prisma: { DbNull: null },
  normalizePolicyMode: (mode: string) => mode,
  recordAuditEvent: vi.fn(),
}));

vi.mock("@ai-sdlc/billing", () => ({
  resolveOrganizationEntitlements: () => ({
    entitlements: { policyEnforcement: true },
    billingAccessOnly: false,
  }),
}));

vi.mock("../middleware/auth.js", () => ({
  requireAuth: async (
    c: { set: (key: string, value: string) => void },
    next: () => Promise<void>,
  ) => {
    c.set("userId", "policy-test-user");
    await next();
  },
  requireOrganizationRole:
    () => async (c: { set: (key: string, value: string) => void }, next: () => Promise<void>) => {
      c.set("organizationId", "policy-test-org");
      c.set("organizationRole", "ADMIN");
      await next();
    },
}));

const { registerPolicyManagementRoutes } = await import("./policy-management.js");

describe("policy simulation route", () => {
  const app = new Hono<AppEnv>();
  registerPolicyManagementRoutes(app);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(
      async (callback: (transaction: unknown) => Promise<unknown>) =>
        callback({
          policy: {
            create: mocks.policyCreate,
            findFirst: mocks.policyFindFirst,
            update: mocks.policyUpdate,
          },
          policyRule: {
            create: mocks.policyRuleCreate,
            findFirst: mocks.policyRuleFindFirst,
          },
          policyRevision: { create: mocks.policyRevisionCreate },
        }),
    );
    mocks.policyFindMany.mockResolvedValue([
      {
        id: "policy-1",
        name: "Secrets",
        enabled: true,
        mode: "ENFORCING",
        policyRules: [
          {
            id: "rule-1",
            name: "Block secrets",
            aiInvolved: true,
            conditionExpression: null,
            sensitiveAreas: ["SECRETS"],
            riskAtLeast: null,
            repositoryCriticalityIn: [],
            action: "BLOCK",
            requiredApprovals: [],
            reason: "Secrets edits blocked.",
          },
        ],
      },
    ]);
    mocks.pullRequestFindMany.mockResolvedValue([
      {
        id: "pr-eligible",
        number: 7,
        title: "Secret change",
        headSha: "head-1",
        lastAnalyzedSha: "head-1",
        aiActivities: [{ involvement: "YES", confidence: 0.9 }],
        riskAssessments: [{ score: 90, level: "CRITICAL" }],
        codeChanges: [{ sensitiveAreas: ["SECRETS"] }],
        policyDecisions: [{ action: "ALLOW" }],
        repository: { owner: "acme", name: "payments", criticality: "HIGH" },
      },
      {
        id: "pr-stale",
        number: 8,
        title: "Stale analysis",
        headSha: "head-2",
        lastAnalyzedSha: "head-1",
        aiActivities: [],
        riskAssessments: [{ score: 20, level: "LOW" }],
        codeChanges: [],
        policyDecisions: [],
        repository: { owner: "acme", name: "docs", criticality: "LOW" },
      },
      {
        id: "pr-no-risk",
        number: 9,
        title: "Missing risk",
        headSha: "head-3",
        lastAnalyzedSha: "head-3",
        aiActivities: [],
        riskAssessments: [],
        codeChanges: [],
        policyDecisions: [],
        repository: { owner: "acme", name: "docs", criticality: "LOW" },
      },
    ]);
  });

  it("simulates organization history without persisting decisions", async () => {
    const response = await app.request("/api/organizations/policy-test-org/policies/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "DRY_RUN", limit: 3 }),
    });
    const body = (await response.json()) as {
      data: {
        totalEvaluated: number;
        review: number;
        block: number;
        skippedStaleAnalysis: number;
        skippedMissingRisk: number;
        decisions: Array<{ pullRequestNumber: number; action: string; changed: boolean }>;
      };
    };

    expect(response.status).toBe(200);
    expect(mocks.policyFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "policy-test-org", enabled: true, mode: { not: "DISABLED" } },
      }),
    );
    expect(mocks.pullRequestFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "policy-test-org", lastAnalyzedSha: { not: null } },
        take: 3,
      }),
    );
    expect(body.data).toMatchObject({
      totalEvaluated: 1,
      review: 1,
      block: 0,
      skippedStaleAnalysis: 1,
      skippedMissingRisk: 1,
      decisions: [{ pullRequestNumber: 7, action: "REVIEW", changed: true }],
    });
  });

  it("rejects an invalid simulation mode", async () => {
    const response = await app.request("/api/organizations/policy-test-org/policies/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "DISABLED" }),
    });
    expect(response.status).toBe(400);
    expect(mocks.policyFindMany).not.toHaveBeenCalled();
    expect(mocks.pullRequestFindMany).not.toHaveBeenCalled();
  });

  it("rejects approval by the author of the current enforcement revision", async () => {
    mocks.policyFindFirst.mockResolvedValue({
      id: "policy-1",
      version: "v3",
      mode: "ENFORCING",
      enabled: true,
    });
    mocks.policyRevisionFindFirst.mockResolvedValue({ actorId: "policy-test-user" });

    const response = await app.request(
      "/api/organizations/policy-test-org/policies/policy-1/approvals",
      { method: "POST" },
    );

    expect(response.status).toBe(403);
    expect(mocks.policyApprovalCreateMany).not.toHaveBeenCalled();
  });

  it("records one approval for the exact pending revision", async () => {
    mocks.policyFindFirst.mockResolvedValue({
      id: "policy-1",
      version: "v3",
      mode: "ENFORCING",
      enabled: true,
    });
    mocks.policyRevisionFindFirst.mockResolvedValue({ actorId: "another-user" });
    mocks.policyApprovalCreateMany.mockResolvedValue({ count: 1 });
    mocks.approvalStatuses.mockResolvedValue(
      new Map([
        [
          "policy-1",
          {
            requiredApprovals: 2,
            approvalCount: 1,
            approved: false,
            revisionAuthorId: "another-user",
            approverIds: ["policy-test-user"],
          },
        ],
      ]),
    );

    const response = await app.request(
      "/api/organizations/policy-test-org/policies/policy-1/approvals",
      { method: "POST" },
    );
    const body = (await response.json()) as {
      data: { requiredApprovals: number; approvalCount: number; approved: boolean };
    };

    expect(response.status).toBe(200);
    expect(mocks.policyApprovalCreateMany).toHaveBeenCalledWith({
      data: [
        {
          organizationId: "policy-test-org",
          policyId: "policy-1",
          version: "v3",
          actorId: "policy-test-user",
        },
      ],
      skipDuplicates: true,
    });
    expect(body.data).toMatchObject({
      requiredApprovals: 2,
      approvalCount: 1,
      approved: false,
    });
  });

  it("creates the initial immutable policy revision with the policy", async () => {
    const policy = {
      id: "new-policy",
      organizationId: "policy-test-org",
      name: "New policy",
      description: null,
      enabled: true,
      mode: "DRY_RUN",
      version: "v1",
      metadata: null,
    };
    mocks.policyCreate.mockResolvedValue(policy);
    mocks.policyFindFirst.mockResolvedValue({ ...policy, policyRules: [] });
    mocks.policyRevisionCreate.mockResolvedValue({});

    const response = await app.request("/api/organizations/policy-test-org/policies", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "New policy" }),
    });

    expect(response.status).toBe(201);
    expect(mocks.policyRevisionCreate).toHaveBeenCalledWith({
      data: {
        organizationId: "policy-test-org",
        policyId: "new-policy",
        actorId: "policy-test-user",
        version: "v1",
        snapshot: {
          id: "new-policy",
          name: "New policy",
          description: null,
          enabled: true,
          mode: "DRY_RUN",
          version: "v1",
          metadata: null,
          policyRules: [],
        },
      },
    });
  });

  it("increments the version and snapshots policy edits", async () => {
    const policy = {
      id: "existing-policy",
      organizationId: "policy-test-org",
      name: "Existing policy",
      description: null,
      enabled: true,
      mode: "DRY_RUN",
      version: "v1",
      metadata: null,
    };
    mocks.policyFindFirst
      .mockResolvedValueOnce(policy)
      .mockResolvedValueOnce({ ...policy, name: "Updated policy", policyRules: [] });
    mocks.policyUpdate.mockResolvedValue({ ...policy, name: "Updated policy", version: "v2" });
    mocks.policyRevisionCreate.mockResolvedValue({});

    const response = await app.request(
      "/api/organizations/policy-test-org/policies/existing-policy",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Updated policy" }),
      },
    );
    const body = (await response.json()) as { data: { version: string } };

    expect(response.status).toBe(200);
    expect(body.data.version).toBe("v2");
    expect(mocks.policyRevisionCreate).toHaveBeenCalledWith({
      data: {
        organizationId: "policy-test-org",
        policyId: "existing-policy",
        actorId: "policy-test-user",
        version: "v2",
        snapshot: {
          id: "existing-policy",
          name: "Updated policy",
          description: null,
          enabled: true,
          mode: "DRY_RUN",
          version: "v2",
          metadata: null,
          policyRules: [],
        },
      },
    });
  });

  it("rejects unsupported policy rule array values instead of silently dropping them", async () => {
    mocks.policyFindFirst.mockResolvedValue({
      id: "policy-1",
      organizationId: "policy-test-org",
    });

    const response = await app.request(
      "/api/organizations/policy-test-org/policies/policy-1/rules",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Sensitive rule",
          action: "BLOCK",
          sensitiveAreas: ["SECRETS", "UNSUPPORTED"],
        }),
      },
    );
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(mocks.policyRuleCreate).not.toHaveBeenCalled();
  });

  it("rejects malformed rule condition thresholds and precedence", async () => {
    mocks.policyFindFirst.mockResolvedValue({
      id: "policy-1",
      organizationId: "policy-test-org",
    });

    const response = await app.request(
      "/api/organizations/policy-test-org/policies/policy-1/rules",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Invalid threshold",
          action: "BLOCK",
          riskAtLeast: 101,
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(mocks.policyRuleCreate).not.toHaveBeenCalled();
  });
});
