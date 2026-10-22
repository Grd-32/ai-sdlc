import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../types.js";

const mocks = vi.hoisted(() => ({
  repositoryFindMany: vi.fn(),
  assessmentFindFirst: vi.fn(),
  assessmentCreate: vi.fn(),
  retryAssessmentFindFirst: vi.fn(),
  retryAssessmentUpdateMany: vi.fn(),
  transaction: vi.fn(),
  repositoryCount: vi.fn(),
  usageAggregate: vi.fn(),
  usageCreate: vi.fn(),
  audit: vi.fn(),
  enqueue: vi.fn(),
}));

vi.mock("@ai-sdlc/db", () => ({
  prisma: {
    repository: { findMany: mocks.repositoryFindMany },
    assessment: {
      findFirst: mocks.assessmentFindFirst,
      create: mocks.assessmentCreate,
    },
    $transaction: mocks.transaction,
  },
  recordAuditEvent: mocks.audit,
}));

vi.mock("@ai-sdlc/billing", () => ({
  resolveOrganizationEntitlements: vi.fn().mockResolvedValue({
    entitlements: {
      maxRepositories: 10,
      assessmentsPerMonth: 1,
      retentionDays: 90,
    },
    currentPeriodStart: new Date("2026-01-01T00:00:00Z"),
    currentPeriodEnd: new Date("2026-02-01T00:00:00Z"),
  }),
}));

vi.mock("../queue.js", () => ({ enqueueAssessment: mocks.enqueue }));

vi.mock("../middleware/auth.js", () => ({
  requireAuth: async (
    context: { set: (key: string, value: string) => void },
    next: () => Promise<void>,
  ) => {
    context.set("userId", "user-1");
    await next();
  },
  requireOrganizationRole:
    () =>
    async (
      context: {
        set: (key: string, value: string) => void;
        req: { param: (key: string) => string };
      },
      next: () => Promise<void>,
    ) => {
      context.set("organizationId", context.req.param("organizationId"));
      context.set("organizationRole", "ADMIN");
      await next();
    },
}));

const { registerAssessmentRoutes } = await import("./assessments.js");

function createTestApp() {
  const app = new Hono<AppEnv>();
  registerAssessmentRoutes(app);
  return app;
}

describe("assessment authorization API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assessmentFindFirst.mockResolvedValue(null);
    mocks.transaction.mockImplementation(
      async (callback: (tx: Record<string, unknown>) => Promise<unknown>) =>
        callback({
          $queryRaw: vi.fn(),
          repository: { count: mocks.repositoryCount },
          usageRecord: { aggregate: mocks.usageAggregate, create: mocks.usageCreate },
          assessment: {
            create: mocks.assessmentCreate,
            findFirst: mocks.retryAssessmentFindFirst,
            updateMany: mocks.retryAssessmentUpdateMany,
          },
        }),
    );
    mocks.repositoryCount.mockResolvedValue(1);
    mocks.usageAggregate.mockResolvedValue({ _sum: { quantity: 0 } });
    mocks.usageCreate.mockResolvedValue({});
    mocks.retryAssessmentFindFirst.mockResolvedValue({ attempt: 1 });
    mocks.retryAssessmentUpdateMany.mockResolvedValue({ count: 1 });
    mocks.repositoryFindMany.mockResolvedValue([
      { id: "repo-1", installation: { permissions: { pull_requests: "read" } } },
    ]);
    mocks.assessmentCreate.mockImplementation((args: { data: Record<string, unknown> }) => ({
      id: "assessment-1",
      status: "QUEUED",
      windowStart: args.data["windowStart"],
      windowEnd: args.data["windowEnd"],
      progress: 0,
      totalPullRequests: 0,
      processedPullRequests: 0,
      report: null,
      errorCode: null,
      errorMessage: null,
      attempt: 1,
      queuedAt: new Date(),
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
      expiresAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      repositories: [{ repository: { id: "repo-1", owner: "org", name: "repo" } }],
    }));
  });

  it("limits repository authorization to repositories visible in the tenant", async () => {
    mocks.repositoryFindMany.mockResolvedValue([]);
    const response = await createTestApp().request("/api/organizations/org-1/assessments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repositoryIds: ["repo-owned-by-other-org"],
        dataProcessingAcknowledged: true,
      }),
    });

    expect(response.status).toBe(400);
    expect(mocks.repositoryFindMany.mock.calls[0]?.[0]).toMatchObject({
      where: { organizationId: "org-1" },
    });
    expect(mocks.assessmentCreate).not.toHaveBeenCalled();
  });

  it("requires explicit data-processing acknowledgement", async () => {
    const response = await createTestApp().request("/api/organizations/org-1/assessments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repositoryIds: ["repo-1"] }),
    });

    expect(response.status).toBe(400);
    expect(mocks.assessmentCreate).not.toHaveBeenCalled();
  });

  it("rejects assessment scopes above the documented 10-repository limit", async () => {
    const response = await createTestApp().request("/api/organizations/org-1/assessments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repositoryIds: Array.from({ length: 11 }, (_, index) => `repo-${index + 1}`),
        dataProcessingAcknowledged: true,
      }),
    });

    expect(response.status).toBe(400);
    expect(mocks.repositoryFindMany).not.toHaveBeenCalled();
    expect(mocks.assessmentCreate).not.toHaveBeenCalled();
  });

  it("records the selected scope and queues a tenant-scoped assessment", async () => {
    const response = await createTestApp().request("/api/organizations/org-1/assessments", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "request-1",
      },
      body: JSON.stringify({
        repositoryIds: ["repo-1"],
        dataProcessingAcknowledged: true,
      }),
    });

    expect(response.status).toBe(202);
    expect(mocks.assessmentCreate.mock.calls[0]?.[0]).toMatchObject({
      data: {
        organizationId: "org-1",
        createdById: "user-1",
        idempotencyKey: "request-1",
        repositories: { create: [{ repositoryId: "repo-1" }] },
      },
    });
    expect(mocks.enqueue).toHaveBeenCalledWith({ assessmentId: "assessment-1", attempt: 1 });
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        eventType: "ASSESSMENT_AUTHORIZED",
      }),
    );
  });

  it("authorizes selected GitLab projects through an active tenant-owned OAuth connection", async () => {
    mocks.repositoryFindMany.mockResolvedValue([
      {
        id: "gitlab-repo-1",
        provider: "GITLAB",
        installation: null,
        sourceControlConnection: {
          accountName: "acme-dev",
          scopes: ["read_user", "read_api", "read_repository"],
        },
      },
    ]);
    const response = await createTestApp().request("/api/organizations/org-1/assessments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repositoryIds: ["gitlab-repo-1"],
        dataProcessingAcknowledged: true,
      }),
    });

    expect(response.status).toBe(202);
    expect(mocks.repositoryFindMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        organizationId: "org-1",
        OR: [
          {
            provider: "GITHUB",
            installation: { is: { active: true, organizationId: "org-1" } },
          },
          {
            provider: "GITLAB",
            sourceControlConnection: {
              is: { active: true, organizationId: "org-1", provider: "GITLAB" },
            },
          },
          {
            provider: "BITBUCKET",
            sourceControlConnection: {
              is: { active: true, organizationId: "org-1", provider: "BITBUCKET" },
            },
          },
          {
            provider: "AZURE_DEVOPS",
            sourceControlConnection: {
              is: { active: true, organizationId: "org-1", provider: "AZURE_DEVOPS" },
            },
          },
        ],
      },
    });
    expect(mocks.assessmentCreate.mock.calls[0]?.[0]).toMatchObject({
      data: {
        permissionsSnapshot: {
          repositories: [
            {
              repositoryId: "gitlab-repo-1",
              provider: "GITLAB",
              accountName: "acme-dev",
              grantedScopes: ["read_user", "read_api", "read_repository"],
            },
          ],
        },
      },
    });
    expect(mocks.enqueue).toHaveBeenCalledWith({ assessmentId: "assessment-1", attempt: 1 });
  });

  it("authorizes selected Azure DevOps repositories through an active tenant-owned connection", async () => {
    mocks.repositoryFindMany.mockResolvedValue([
      {
        id: "azure-repo-1",
        provider: "AZURE_DEVOPS",
        installation: null,
        sourceControlConnection: {
          accountName: "contoso",
          scopes: ["vso.project", "vso.code"],
        },
      },
    ]);
    const response = await createTestApp().request("/api/organizations/org-1/assessments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repositoryIds: ["azure-repo-1"],
        dataProcessingAcknowledged: true,
      }),
    });

    expect(response.status).toBe(202);
    expect(mocks.assessmentCreate.mock.calls[0]?.[0]).toMatchObject({
      data: {
        permissionsSnapshot: {
          repositories: [
            {
              repositoryId: "azure-repo-1",
              provider: "AZURE_DEVOPS",
              accountName: "contoso",
              accessModel:
                "Existing Azure DevOps Entra OAuth connection; encrypted server-side tokens",
              grantedScopes: ["vso.project", "vso.code"],
            },
          ],
        },
      },
    });
  });

  it("reserves another assessment attempt before queueing a retry", async () => {
    const response = await createTestApp().request(
      "/api/organizations/org-1/assessments/assessment-1/retry",
      { method: "POST" },
    );

    expect(response.status).toBe(202);
    expect(mocks.usageCreate.mock.calls[0]?.[0]).toMatchObject({
      data: {
        type: "ASSESSMENT_ATTEMPT",
        idempotencyKey: "assessment-attempt:assessment-1:2",
      },
    });
    expect(mocks.enqueue).toHaveBeenCalledWith({ assessmentId: "assessment-1", attempt: 2 });
  });

  it("does not retry an assessment after reaching the current attempt quota", async () => {
    mocks.usageAggregate.mockResolvedValue({ _sum: { quantity: 1 } });
    const response = await createTestApp().request(
      "/api/organizations/org-1/assessments/assessment-1/retry",
      { method: "POST" },
    );

    expect(response.status).toBe(429);
    expect(mocks.retryAssessmentUpdateMany).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});
