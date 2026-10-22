import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../types.js";

const mocks = vi.hoisted(() => ({
  installationFindFirst: vi.fn(),
  organizationFindUnique: vi.fn(),
  organizationUpdate: vi.fn(),
  deletionFindFirst: vi.fn(),
  deletionCreate: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn(),
  audit: vi.fn(),
  installationUpdateMany: vi.fn(),
  repositoryFindMany: vi.fn(),
  repositoryUpdateMany: vi.fn(),
  assessmentUpdateMany: vi.fn(),
  role: "OWNER",
}));

vi.mock("@ai-sdlc/db", () => ({
  prisma: {
    gitHubInstallation: { findFirst: mocks.installationFindFirst },
    organization: {
      findUnique: mocks.organizationFindUnique,
      update: mocks.organizationUpdate,
    },
    organizationDeletionRequest: { findFirst: mocks.deletionFindFirst },
    $transaction: mocks.transaction,
  },
  recordAuditEvent: mocks.audit,
}));

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
      context.set("organizationRole", mocks.role);
      await next();
    },
}));

const { registerSettingsRoutes } = await import("./settings.js");

function createTestApp() {
  const app = new Hono<AppEnv>();
  registerSettingsRoutes(app);
  return app;
}

describe("organization settings self-service API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.role = "OWNER";
    mocks.organizationFindUnique.mockResolvedValue({
      slug: "acme",
      billingSubscription: { status: "ACTIVE" },
    });
    mocks.organizationUpdate.mockResolvedValue({ policyApprovalQuorum: 3 });
    mocks.installationFindFirst.mockResolvedValue({
      id: "installation-internal",
      active: true,
      githubInstallationId: "github-installation",
    });
    mocks.transaction.mockImplementation(
      async (callback: (tx: Record<string, unknown>) => Promise<unknown>) =>
        callback({
          $queryRaw: vi.fn(),
          gitHubInstallation: { updateMany: mocks.installationUpdateMany },
          repository: {
            findMany: mocks.repositoryFindMany,
            updateMany: mocks.repositoryUpdateMany,
          },
          assessment: { updateMany: mocks.assessmentUpdateMany },
          organizationDeletionRequest: {
            findFirst: mocks.deletionFindFirst,
            create: mocks.deletionCreate,
          },
          auditEvent: { create: mocks.auditCreate },
        }),
    );
    mocks.deletionFindFirst.mockResolvedValue(null);
    mocks.deletionCreate.mockResolvedValue({
      id: "deletion-1",
      status: "PENDING",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    mocks.installationUpdateMany.mockResolvedValue({ count: 1 });
    mocks.repositoryFindMany.mockResolvedValue([{ id: "repo-1" }]);
    mocks.repositoryUpdateMany.mockResolvedValue({ count: 1 });
    mocks.assessmentUpdateMany.mockResolvedValue({ count: 1 });
    mocks.auditCreate.mockResolvedValue({});
  });

  it("records an owner-confirmed deletion request and reports subscription dependency", async () => {
    const response = await createTestApp().request(
      "/api/organizations/org-1/settings/data-deletion",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmOrganizationSlug: "acme" }),
      },
    );

    expect(response.status).toBe(202);
    const payload: unknown = await response.json();
    expect(payload).toMatchObject({
      data: {
        status: "PENDING",
        alreadyPending: false,
        subscriptionNeedsResolution: true,
      },
    });
    expect(mocks.deletionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          organizationId: "org-1",
          organizationSlug: "acme",
          requestedById: "user-1",
        },
      }),
    );
    expect(mocks.auditCreate).toHaveBeenCalled();
  });

  it("allows owners to configure an audited enforcement approval quorum", async () => {
    const response = await createTestApp().request(
      "/api/organizations/org-1/settings/policy-approval-quorum",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ policyApprovalQuorum: 3 }),
      },
    );

    expect(response.status).toBe(200);
    expect(mocks.organizationUpdate).toHaveBeenCalledWith({
      where: { id: "org-1" },
      data: { policyApprovalQuorum: 3 },
      select: { policyApprovalQuorum: true },
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        eventType: "ORGANIZATION_POLICY_APPROVAL_QUORUM_UPDATED",
        metadata: { policyApprovalQuorum: 3 },
      }),
    );
  });

  it("rejects an approval quorum outside the supported range", async () => {
    const response = await createTestApp().request(
      "/api/organizations/org-1/settings/policy-approval-quorum",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ policyApprovalQuorum: 6 }),
      },
    );

    expect(response.status).toBe(400);
    expect(mocks.organizationUpdate).not.toHaveBeenCalled();
  });

  it("requires the organization slug as deletion confirmation", async () => {
    const response = await createTestApp().request(
      "/api/organizations/org-1/settings/data-deletion",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmOrganizationSlug: "another-org" }),
      },
    );

    expect(response.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("limits deletion requests to organization owners", async () => {
    mocks.role = "ADMIN";
    const response = await createTestApp().request(
      "/api/organizations/org-1/settings/data-deletion",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmOrganizationSlug: "acme" }),
      },
    );

    expect(response.status).toBe(403);
    expect(mocks.organizationFindUnique).not.toHaveBeenCalled();
  });

  it("disconnects only an installation belonging to the authorized organization", async () => {
    const response = await createTestApp().request(
      "/api/organizations/org-1/installations/installation-internal",
      { method: "DELETE" },
    );

    expect(response.status).toBe(200);
    expect(mocks.installationFindFirst).toHaveBeenCalledWith({
      where: { id: "installation-internal", organizationId: "org-1" },
      select: { id: true, active: true, githubInstallationId: true },
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        eventType: "GITHUB_INSTALLATION_DISCONNECTED",
      }),
    );
    expect(mocks.installationUpdateMany).toHaveBeenCalledWith({
      where: { id: "installation-internal", organizationId: "org-1", active: true },
      data: { active: false },
    });
    expect(mocks.repositoryUpdateMany).toHaveBeenCalledWith({
      where: { githubInstallationId: "installation-internal", organizationId: "org-1" },
      data: { enabled: false },
    });
    expect(mocks.assessmentUpdateMany).toHaveBeenCalledTimes(1);
    const assessmentUpdate = mocks.assessmentUpdateMany.mock.calls[0]?.[0] as unknown as {
      where: {
        organizationId: "org-1";
        status: { in: string[] };
        repositories: { some: { repositoryId: { in: string[] } } };
      };
      data: {
        status: string;
        cancelledAt: unknown;
        errorCode: string;
        errorMessage: string;
      };
    };
    expect(assessmentUpdate).toMatchObject({
      where: {
        organizationId: "org-1",
        status: { in: ["CREATED", "AUTHORIZATION_PENDING", "QUEUED", "RUNNING"] },
        repositories: { some: { repositoryId: { in: ["repo-1"] } } },
      },
      data: {
        status: "CANCELLED",
        errorCode: "GITHUB_INSTALLATION_DISCONNECTED",
        errorMessage: "The GitHub installation was disconnected by an organization admin.",
      },
    });
    expect(assessmentUpdate.data.cancelledAt).toBeInstanceOf(Date);
  });
});
