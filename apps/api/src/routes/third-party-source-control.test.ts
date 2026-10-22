import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../types.js";

const mocks = vi.hoisted(() => ({
  connectionFindFirst: vi.fn(),
  connectionUpdateMany: vi.fn(),
  connectionUpsert: vi.fn(),
  ensureOrganizationAccess: vi.fn(),
  repositoryFindMany: vi.fn(),
  repositoryUpdateMany: vi.fn(),
  repositoryUpsert: vi.fn(),
  transaction: vi.fn(),
  bitbucketRepositories: vi.fn(),
  azureProjects: vi.fn(),
  azureRepositories: vi.fn(),
  bitbucketCurrentUser: vi.fn(),
  bitbucketExchange: vi.fn(),
  azureExchange: vi.fn(),
  audit: vi.fn(),
  resolveEntitlements: vi.fn(),
}));

vi.mock("@ai-sdlc/db", () => ({
  prisma: {
    sourceControlConnection: {
      findFirst: mocks.connectionFindFirst,
      updateMany: mocks.connectionUpdateMany,
      upsert: mocks.connectionUpsert,
    },
    repository: {
      findMany: mocks.repositoryFindMany,
      updateMany: mocks.repositoryUpdateMany,
      upsert: mocks.repositoryUpsert,
    },
    $transaction: mocks.transaction,
  },
  ensureOrganizationAccess: mocks.ensureOrganizationAccess,
  recordAuditEvent: mocks.audit,
}));

vi.mock("@ai-sdlc/billing", () => ({
  resolveOrganizationEntitlements: mocks.resolveEntitlements,
}));

vi.mock("@ai-sdlc/source-control", () => ({
  AzureDevOpsClient: vi.fn().mockImplementation(() => ({
    listProjects: mocks.azureProjects,
    listRepositories: mocks.azureRepositories,
  })),
  BitbucketClient: vi.fn().mockImplementation(() => ({
    getCurrentUser: mocks.bitbucketCurrentUser,
    listRepositories: mocks.bitbucketRepositories,
  })),
  decryptSourceControlCredentials: vi.fn().mockReturnValue({
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  }),
  encryptSourceControlCredentials: vi.fn().mockReturnValue("encrypted"),
  encryptSourceControlSecret: vi.fn().mockReturnValue("encrypted-webhook-secret"),
  exchangeAzureDevOpsOAuthCode: mocks.azureExchange,
  exchangeBitbucketOAuthCode: mocks.bitbucketExchange,
  getAzureDevOpsAuthorizationUrl: vi.fn(),
  getBitbucketAuthorizationUrl: vi.fn(),
  refreshAzureDevOpsOAuthToken: vi.fn(),
  refreshBitbucketOAuthToken: vi.fn(),
  revokeBitbucketOAuthToken: vi.fn(),
  SourceControlProviderError: class SourceControlProviderError extends Error {
    constructor(
      message: string,
      readonly kind: string,
    ) {
      super(message);
    }
  },
  validateSourceControlEncryptionKey: vi.fn(),
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

vi.mock("../auth/session.js", () => ({
  SESSION_COOKIE: "ai_sdlc_session",
  verifySessionCookieValue: vi.fn().mockResolvedValue({ userId: "user-1" }),
}));

const { registerThirdPartySourceControlRoutes } = await import("./third-party-source-control.js");

const connection = {
  id: "connection-1",
  organizationId: "org-1",
  provider: "BITBUCKET",
  externalAccountId: "{account}",
  accountName: "acme",
  credentialCiphertext: "encrypted",
  scopes: ["account", "repository", "pullrequest"],
  active: true,
};

const repository = {
  provider: "BITBUCKET",
  externalId: "{repo-1}",
  owner: "acme",
  name: "service",
  defaultBranch: "main",
  private: true,
  webUrl: "https://bitbucket.org/acme/service",
  original: {
    provider: "BITBUCKET",
    externalId: "{repo-1}",
    collectedAt: "2026-10-14T00:00:00.000Z",
  },
};

function createTestApp() {
  const app = new Hono<AppEnv>();
  registerThirdPartySourceControlRoutes(app);
  return app;
}

describe("Bitbucket and Azure DevOps application connections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("APP_URL", "https://nomalog.example");
    vi.stubEnv("BITBUCKET_OAUTH_CLIENT_ID", "bitbucket-client-id");
    vi.stubEnv("BITBUCKET_OAUTH_CLIENT_SECRET", "test-bitbucket-secret");
    vi.stubEnv("AZURE_DEVOPS_OAUTH_CLIENT_ID", "azure-client-id");
    vi.stubEnv("AZURE_DEVOPS_OAUTH_CLIENT_SECRET", "test-azure-secret");
    mocks.connectionFindFirst.mockResolvedValue(connection);
    mocks.connectionUpdateMany.mockResolvedValue({ count: 1 });
    mocks.connectionUpsert.mockResolvedValue({ id: "connection-1" });
    mocks.ensureOrganizationAccess.mockResolvedValue({ organizationId: "org-1", role: "ADMIN" });
    mocks.bitbucketRepositories.mockResolvedValue({
      items: [repository],
      complete: true,
      capability: { status: "SUPPORTED", detail: "Listed." },
    });
    mocks.azureProjects.mockResolvedValue({
      items: [{ id: "project-1", name: "platform" }],
      complete: true,
      capability: { status: "SUPPORTED", detail: "Listed." },
    });
    mocks.azureRepositories.mockResolvedValue({
      items: [
        {
          ...repository,
          provider: "AZURE_DEVOPS",
          externalId: "repo-azure-1",
          owner: "acme/platform",
        },
      ],
      complete: true,
      capability: { status: "SUPPORTED", detail: "Listed." },
    });
    mocks.resolveEntitlements.mockResolvedValue({
      entitlements: { maxRepositories: 10 },
    });
    mocks.repositoryFindMany.mockResolvedValue([]);
    mocks.repositoryUpsert.mockResolvedValue({
      id: "repository-1",
      owner: repository.owner,
      name: repository.name,
      provider: "BITBUCKET",
    });
    mocks.repositoryUpdateMany.mockResolvedValue({ count: 1 });
    mocks.bitbucketCurrentUser.mockResolvedValue({
      uuid: "{account}",
      username: "acme",
      displayName: "Acme",
    });
    mocks.bitbucketExchange.mockResolvedValue({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresIn: 3600,
      scopes: ["account", "repository", "pullrequest"],
    });
    mocks.azureExchange.mockResolvedValue({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresIn: 3600,
      scope: ["vso.code", "vso.project"],
    });
    mocks.transaction.mockImplementation(
      async (callback: (tx: Record<string, unknown>) => Promise<unknown>) =>
        callback({
          $queryRaw: vi.fn(),
          sourceControlConnection: { updateMany: mocks.connectionUpdateMany },
          repository: {
            findMany: mocks.repositoryFindMany,
            updateMany: mocks.repositoryUpdateMany,
            upsert: mocks.repositoryUpsert,
          },
        }),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates a one-time Bitbucket webhook secret scoped to an active tenant connection", async () => {
    vi.stubEnv("SOURCE_CONTROL_ENCRYPTION_KEY", Buffer.alloc(32, 5).toString("base64"));
    const response = await createTestApp().request(
      "/api/organizations/org-1/source-control/bitbucket/webhook-secret",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionId: connection.id }),
      },
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      data: { webhookUrl: string; secret: string; events: string[]; signatureHeader: string };
    };
    expect(body.data.webhookUrl).toBe(
      "https://nomalog.example/api/webhooks/bitbucket/connection-1",
    );
    expect(body.data.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.data.events).toEqual(["pullrequest:created", "pullrequest:updated"]);
    expect(body.data.signatureHeader).toContain("X-Hub-Signature");
    expect(mocks.connectionUpdateMany).toHaveBeenCalledWith({
      where: {
        id: connection.id,
        organizationId: "org-1",
        provider: "BITBUCKET",
        active: true,
      },
      data: {
        webhookSecretCiphertext: "encrypted-webhook-secret",
        webhookSecretHash: null,
      },
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "BITBUCKET_WEBHOOK_SECRET_ROTATED",
        metadata: { connectionId: connection.id },
      }),
    );
  });

  it("creates an Azure DevOps Basic-auth secret scoped to an active tenant connection", async () => {
    vi.stubEnv("SOURCE_CONTROL_ENCRYPTION_KEY", Buffer.alloc(32, 5).toString("base64"));
    const response = await createTestApp().request(
      "/api/organizations/org-1/source-control/azure-devops/webhook-secret",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionId: connection.id }),
      },
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      data: {
        webhookUrl: string;
        username: string;
        password: string;
        events: string[];
        authentication: string;
        resourceDetails: string;
      };
    };
    expect(body.data.webhookUrl).toBe(
      "https://nomalog.example/api/webhooks/azure-devops/connection-1",
    );
    expect(body.data.username).toBe("ai-sdlc");
    expect(body.data.password).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.data.events).toEqual(["git.pullrequest.created", "git.pullrequest.updated"]);
    expect(body.data.authentication).toContain("Basic");
    expect(body.data.resourceDetails).toBe("All");
    expect(mocks.connectionUpdateMany).toHaveBeenCalledWith({
      where: {
        id: connection.id,
        organizationId: "org-1",
        provider: "AZURE_DEVOPS",
        active: true,
      },
      data: {
        webhookSecretCiphertext: "encrypted-webhook-secret",
        webhookSecretHash: null,
      },
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "AZURE_DEVOPS_WEBHOOK_SECRET_ROTATED",
        metadata: { connectionId: connection.id },
      }),
    );
  });

  it("verifies Bitbucket OAuth state and persists an encrypted account connection", async () => {
    const response = await createTestApp().request(
      "/api/auth/bitbucket/callback?code=one-time-code&state=state-value",
      {
        headers: {
          cookie:
            "ai_sdlc_session=session; nomalog_bitbucket_state=state-value; nomalog_bitbucket_org=org-1",
        },
      },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://nomalog.example/dashboard/repositories?bitbucketConnected=1",
    );
    expect(mocks.bitbucketExchange).toHaveBeenCalledOnce();
    expect(mocks.bitbucketCurrentUser).toHaveBeenCalledOnce();
    expect(mocks.connectionUpsert).toHaveBeenCalledOnce();
    expect(JSON.stringify(mocks.connectionUpsert.mock.calls[0]?.[0])).toContain(
      '"credentialCiphertext":"encrypted"',
    );
  });

  it("rejects a mismatched Bitbucket OAuth state without exchanging the code", async () => {
    const response = await createTestApp().request(
      "/api/auth/bitbucket/callback?code=one-time-code&state=attacker-state",
      {
        headers: {
          cookie:
            "ai_sdlc_session=session; nomalog_bitbucket_state=state-value; nomalog_bitbucket_org=org-1",
        },
      },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("bitbucketError=invalid_oauth_state");
    expect(mocks.bitbucketExchange).not.toHaveBeenCalled();
  });

  it("uses Azure DevOps PKCE callback scope checks before persisting", async () => {
    const response = await createTestApp().request(
      "/api/auth/azure-devops/callback?code=one-time-code&state=state-value",
      {
        headers: {
          cookie:
            "ai_sdlc_session=session; nomalog_azure_devops_state=state-value; nomalog_azure_devops_verifier=verifier; nomalog_azure_devops_org=org-1; nomalog_azure_devops_target=acme",
        },
      },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://nomalog.example/dashboard/repositories?azureDevOpsConnected=1",
    );
    expect(mocks.azureExchange).toHaveBeenCalledOnce();
    expect(mocks.connectionUpsert).toHaveBeenCalledOnce();
    expect(JSON.stringify(mocks.connectionUpsert.mock.calls[0]?.[0])).toContain(
      '"externalAccountId":"acme"',
    );
  });

  it("accepts and persists the explicitly supported Advanced Security read scope", async () => {
    mocks.azureExchange.mockResolvedValueOnce({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresIn: 3600,
      scope: ["vso.code", "vso.project", "vso.advsec"],
    });
    const response = await createTestApp().request(
      "/api/auth/azure-devops/callback?code=one-time-code&state=state-value",
      {
        headers: {
          cookie:
            "ai_sdlc_session=session; nomalog_azure_devops_state=state-value; nomalog_azure_devops_verifier=verifier; nomalog_azure_devops_org=org-1; nomalog_azure_devops_target=acme",
        },
      },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("azureDevOpsConnected=1");
    expect(JSON.stringify(mocks.connectionUpsert.mock.calls[0]?.[0])).toContain('"vso.advsec"');
  });

  it("rejects Azure DevOps grants that include additional vso scopes", async () => {
    mocks.azureExchange.mockResolvedValueOnce({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresIn: 3600,
      scope: ["vso.code", "vso.project", "vso.code_write"],
    });
    const response = await createTestApp().request(
      "/api/auth/azure-devops/callback?code=one-time-code&state=state-value",
      {
        headers: {
          cookie:
            "ai_sdlc_session=session; nomalog_azure_devops_state=state-value; nomalog_azure_devops_verifier=verifier; nomalog_azure_devops_org=org-1; nomalog_azure_devops_target=acme",
        },
      },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("azureDevOpsError=azure_devops_permission");
    expect(mocks.connectionUpsert).not.toHaveBeenCalled();
  });

  it("looks up the selected connection within the authorized organization", async () => {
    mocks.connectionFindFirst.mockResolvedValueOnce(null);
    const response = await createTestApp().request(
      "/api/organizations/org-1/source-control/bitbucket/repositories?connectionId=connection-1&workspace=acme",
    );

    expect(response.status).toBe(401);
    expect(mocks.connectionFindFirst).toHaveBeenCalledWith({
      where: {
        id: "connection-1",
        organizationId: "org-1",
        provider: "BITBUCKET",
        active: true,
      },
    });
    expect(mocks.bitbucketRepositories).not.toHaveBeenCalled();
  });

  it("persists only repositories re-verified from the selected Bitbucket workspace", async () => {
    const response = await createTestApp().request(
      "/api/organizations/org-1/source-control/bitbucket/repositories",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          connectionId: "connection-1",
          workspace: "acme",
          repositoryIds: ["{repo-1}"],
        }),
      },
    );

    expect(response.status).toBe(201);
    expect(mocks.connectionFindFirst).toHaveBeenCalledWith({
      where: {
        id: "connection-1",
        organizationId: "org-1",
        provider: "BITBUCKET",
        active: true,
      },
    });
    expect(JSON.stringify(mocks.repositoryUpsert.mock.calls[0]?.[0])).toContain(
      '"sourceControlConnectionId":"connection-1"',
    );
    expect(JSON.stringify(mocks.repositoryUpsert.mock.calls[0]?.[0])).toContain(
      '"externalId":"{repo-1}"',
    );
  });

  it("rejects a repository that is not present in the selected workspace", async () => {
    const response = await createTestApp().request(
      "/api/organizations/org-1/source-control/bitbucket/repositories",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          connectionId: "connection-1",
          workspace: "acme",
          repositoryIds: ["not-accessible"],
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(mocks.repositoryUpsert).not.toHaveBeenCalled();
  });

  it("enforces repository quota before persisting a selection", async () => {
    mocks.resolveEntitlements.mockResolvedValueOnce({
      entitlements: { maxRepositories: 1 },
    });
    mocks.repositoryFindMany.mockResolvedValueOnce([
      { provider: "GITHUB", externalId: "existing-repository" },
    ]);
    const response = await createTestApp().request(
      "/api/organizations/org-1/source-control/bitbucket/repositories",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          connectionId: "connection-1",
          workspace: "acme",
          repositoryIds: ["{repo-1}"],
        }),
      },
    );

    expect(response.status).toBe(409);
    expect(mocks.repositoryUpsert).not.toHaveBeenCalled();
  });

  it("verifies Azure projects and repositories against the same organization-scoped token", async () => {
    mocks.connectionFindFirst.mockResolvedValueOnce({
      ...connection,
      provider: "AZURE_DEVOPS",
      accountName: "acme",
    });
    const response = await createTestApp().request(
      "/api/organizations/org-1/source-control/azure-devops/repositories",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          connectionId: "connection-1",
          project: "project-1",
          repositoryIds: ["repo-azure-1"],
        }),
      },
    );

    expect(response.status).toBe(201);
    expect(mocks.azureProjects).toHaveBeenCalledOnce();
    expect(mocks.azureRepositories).toHaveBeenCalledWith("platform");
    expect(JSON.stringify(mocks.repositoryUpsert.mock.calls[0]?.[0])).toContain(
      '"externalId":"repo-azure-1"',
    );
  });

  it("rejects projects not visible to the connected Azure DevOps account", async () => {
    mocks.connectionFindFirst.mockResolvedValueOnce({
      ...connection,
      provider: "AZURE_DEVOPS",
      accountName: "acme",
    });
    const response = await createTestApp().request(
      "/api/organizations/org-1/source-control/azure-devops/repositories",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          connectionId: "connection-1",
          project: "unauthorized-project",
          repositoryIds: ["repo-azure-1"],
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(mocks.azureRepositories).not.toHaveBeenCalled();
    expect(mocks.repositoryUpsert).not.toHaveBeenCalled();
  });

  it("disconnects Azure DevOps locally and disables linked repositories", async () => {
    mocks.connectionFindFirst.mockResolvedValueOnce({
      ...connection,
      provider: "AZURE_DEVOPS",
      accountName: "acme",
    });
    const response = await createTestApp().request(
      "/api/organizations/org-1/source-control/connections/connection-1/external",
      { method: "DELETE" },
    );
    const body = (await response.json()) as {
      data: { disconnected: boolean; remoteRevocation: string };
    };

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ disconnected: true, remoteRevocation: "NOT_SUPPORTED" });
    expect(JSON.stringify(mocks.connectionUpdateMany.mock.calls[0]?.[0])).toContain(
      '"credentialCiphertext":"REVOKED"',
    );
    expect(JSON.stringify(mocks.connectionUpdateMany.mock.calls[0]?.[0])).toContain(
      '"active":false',
    );
    expect(JSON.stringify(mocks.repositoryUpdateMany.mock.calls[0]?.[0])).toContain(
      '"sourceControlConnectionId":"connection-1"',
    );
  });
});
