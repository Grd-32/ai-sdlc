import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { Hono } from "hono";
import type { AppEnv } from "../types.js";

const mocks = vi.hoisted(() => ({
  connectionFindFirst: vi.fn(),
  connectionUpdateMany: vi.fn(),
  repositoryFindMany: vi.fn(),
  repositoryUpsert: vi.fn(),
  transaction: vi.fn(),
  gitLabListRepositories: vi.fn(),
  audit: vi.fn(),
  resolveEntitlements: vi.fn(),
}));

vi.mock("@ai-sdlc/db", () => ({
  prisma: {
    sourceControlConnection: {
      findFirst: mocks.connectionFindFirst,
      updateMany: mocks.connectionUpdateMany,
    },
    repository: {
      findMany: mocks.repositoryFindMany,
      upsert: mocks.repositoryUpsert,
    },
    $transaction: mocks.transaction,
  },
  ensureOrganizationAccess: vi.fn(),
  recordAuditEvent: mocks.audit,
}));

vi.mock("@ai-sdlc/billing", () => ({
  resolveOrganizationEntitlements: mocks.resolveEntitlements,
}));

vi.mock("@ai-sdlc/source-control", () => ({
  decryptGitLabCredentials: vi.fn().mockReturnValue({
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  }),
  encryptGitLabCredentials: vi.fn(),
  exchangeGitLabOAuthCode: vi.fn(),
  refreshGitLabOAuthToken: vi.fn(),
  revokeGitLabOAuthToken: vi.fn(),
  validateGitLabEncryptionKey: vi.fn(),
  SourceControlProviderError: class SourceControlProviderError extends Error {
    constructor(
      message: string,
      readonly kind: string,
    ) {
      super(message);
    }
  },
}));

vi.mock("@ai-sdlc/source-control/gitlab", () => ({
  GitLabClient: vi.fn().mockImplementation(() => ({
    listRepositories: mocks.gitLabListRepositories,
    getCapabilities: () => ({ provider: "GITLAB", capabilities: {} }),
  })),
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
      context.set("organizationRole", "ADMIN");
      await next();
    },
}));

const { registerGitLabRoutes } = await import("./gitlab.js");

function createTestApp() {
  const app = new Hono<AppEnv>();
  registerGitLabRoutes(app);
  return app;
}

const connection = {
  id: "connection-1",
  organizationId: "org-1",
  provider: "GITLAB",
  active: true,
  credentialCiphertext: "encrypted",
};

const project = {
  provider: "GITLAB",
  externalId: "project-42",
  owner: "group",
  name: "service",
  defaultBranch: "main",
  private: true,
  webUrl: "https://gitlab.com/group/service",
  original: {
    provider: "GITLAB",
    externalId: "project-42",
    collectedAt: "2026-10-14T00:00:00.000Z",
  },
};

describe("GitLab repository selection API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connectionFindFirst.mockResolvedValue(connection);
    mocks.connectionUpdateMany.mockResolvedValue({ count: 1 });
    mocks.gitLabListRepositories.mockResolvedValue({
      items: [project],
      complete: true,
      capability: { status: "SUPPORTED", detail: "Project discovery succeeded." },
    });
    mocks.resolveEntitlements.mockResolvedValue({
      entitlements: { maxRepositories: 10 },
    });
    mocks.repositoryFindMany.mockResolvedValue([]);
    mocks.repositoryUpsert.mockResolvedValue({
      id: "repo-1",
      owner: project.owner,
      name: project.name,
      provider: "GITLAB",
    });
    mocks.transaction.mockImplementation(
      async (callback: (tx: Record<string, unknown>) => Promise<unknown>) =>
        callback({
          $queryRaw: vi.fn(),
          repository: {
            findMany: mocks.repositoryFindMany,
            upsert: mocks.repositoryUpsert,
          },
        }),
    );
  });

  it("scopes connection lookup and saves only projects returned by that connection", async () => {
    const response = await createTestApp().request(
      "/api/organizations/org-1/source-control/gitlab/repositories",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionId: "connection-1", projectIds: ["project-42"] }),
      },
    );

    expect(response.status).toBe(201);
    expect(mocks.connectionFindFirst.mock.calls[0]?.[0]).toMatchObject({
      where: {
        id: "connection-1",
        organizationId: "org-1",
        provider: "GITLAB",
        active: true,
      },
    });
    expect(mocks.repositoryUpsert).toHaveBeenCalledTimes(1);
    expect(mocks.repositoryUpsert.mock.calls[0]?.[0]).toMatchObject({
      create: {
        organizationId: "org-1",
        sourceControlConnectionId: "connection-1",
        externalId: "project-42",
      },
    });
  });

  describe("GitLab webhook secret setup", () => {
    beforeEach(() => {
      process.env["APP_URL"] = "https://nomalog.example";
      mocks.connectionUpdateMany.mockResolvedValue({ count: 1 });
    });

    it("returns the one-time webhook secret and stores only its hash", async () => {
      const response = await createTestApp().request(
        "/api/organizations/org-1/source-control/gitlab/webhook-secret",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ connectionId: connection.id }),
        },
      );

      expect(response.status).toBe(201);
      const body = (await response.json()) as {
        data: { webhookUrl: string; secret: string };
      };
      expect(body.data.webhookUrl).toBe("https://nomalog.example/api/webhooks/gitlab");
      expect(body.data.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(mocks.connectionUpdateMany).toHaveBeenCalledWith({
        where: {
          id: connection.id,
          organizationId: "org-1",
          provider: "GITLAB",
          active: true,
        },
        data: {
          webhookSecretHash: createHash("sha256").update(body.data.secret).digest("hex"),
        },
      });
    });

    it("does not reveal a secret for a connection outside the organization", async () => {
      mocks.connectionUpdateMany.mockResolvedValue({ count: 0 });
      const response = await createTestApp().request(
        "/api/organizations/org-1/source-control/gitlab/webhook-secret",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ connectionId: "foreign-connection" }),
        },
      );

      expect(response.status).toBe(404);
      expect(mocks.connectionUpdateMany).toHaveBeenCalledTimes(1);
      expect(mocks.connectionUpdateMany.mock.calls[0]?.[0]).toMatchObject({
        where: {
          id: "foreign-connection",
          organizationId: "org-1",
          provider: "GITLAB",
          active: true,
        },
      });
    });
  });

  it("rejects a project not visible to the authorized GitLab connection", async () => {
    const response = await createTestApp().request(
      "/api/organizations/org-1/source-control/gitlab/repositories",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionId: "connection-1", projectIds: ["another-project"] }),
      },
    );

    expect(response.status).toBe(400);
    expect(mocks.repositoryUpsert).not.toHaveBeenCalled();
  });

  it("enforces the repository entitlement under the organization transaction lock", async () => {
    mocks.resolveEntitlements.mockResolvedValue({
      entitlements: { maxRepositories: 1 },
    });
    mocks.repositoryFindMany.mockResolvedValue([
      { provider: "GITHUB", externalId: "existing-project" },
    ]);

    const response = await createTestApp().request(
      "/api/organizations/org-1/source-control/gitlab/repositories",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionId: "connection-1", projectIds: ["project-42"] }),
      },
    );

    expect(response.status).toBe(409);
    expect(mocks.repositoryUpsert).not.toHaveBeenCalled();
    expect(mocks.resolveEntitlements).toHaveBeenCalledWith("org-1", expect.any(Object));
  });

  it("rejects a connection owned by another organization", async () => {
    mocks.connectionFindFirst.mockResolvedValue(null);

    const response = await createTestApp().request(
      "/api/organizations/org-1/source-control/gitlab/repositories",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionId: "foreign-connection", projectIds: ["project-42"] }),
      },
    );

    expect(response.status).toBe(404);
    expect(mocks.gitLabListRepositories).not.toHaveBeenCalled();
  });
});
