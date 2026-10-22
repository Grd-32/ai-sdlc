import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn<
    (args: {
      where: {
        id: string;
        organizationId: string;
        provider: "AZURE_DEVOPS";
        active: true;
        credentialCiphertext: string;
      };
      data: { credentialCiphertext: string; scopes: string[] };
    }) => Promise<{ count: number }>
  >(),
  findFirst: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@ai-sdlc/db", () => ({
  prisma: {
    sourceControlConnection: {
      updateMany: mocks.updateMany,
      findFirst: mocks.findFirst,
    },
  },
}));

vi.mock("@ai-sdlc/source-control", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ai-sdlc/source-control")>();
  return { ...actual, refreshAzureDevOpsOAuthToken: mocks.refresh };
});

const { AzureDevOpsClient, encryptSourceControlCredentials, SourceControlProviderError } =
  await import("@ai-sdlc/source-control");
const { createAzureDevOpsClient } = await import("./azure-devops-connection.js");

describe("worker Azure DevOps connection credentials", () => {
  const originalEncryptionKey = process.env["SOURCE_CONTROL_ENCRYPTION_KEY"];
  const originalClientId = process.env["AZURE_DEVOPS_OAUTH_CLIENT_ID"];
  const originalClientSecret = process.env["AZURE_DEVOPS_OAUTH_CLIENT_SECRET"];
  const originalTenantId = process.env["AZURE_DEVOPS_TENANT_ID"];

  beforeEach(() => {
    vi.clearAllMocks();
    process.env["SOURCE_CONTROL_ENCRYPTION_KEY"] = Buffer.alloc(32, 3).toString("base64");
    process.env["AZURE_DEVOPS_OAUTH_CLIENT_ID"] = "client-id";
    process.env["AZURE_DEVOPS_OAUTH_CLIENT_SECRET"] = "client-secret";
    process.env["AZURE_DEVOPS_TENANT_ID"] = "organizations";
    mocks.updateMany.mockResolvedValue({ count: 1 });
  });

  afterEach(() => {
    if (originalEncryptionKey === undefined) delete process.env["SOURCE_CONTROL_ENCRYPTION_KEY"];
    else process.env["SOURCE_CONTROL_ENCRYPTION_KEY"] = originalEncryptionKey;
    if (originalClientId === undefined) delete process.env["AZURE_DEVOPS_OAUTH_CLIENT_ID"];
    else process.env["AZURE_DEVOPS_OAUTH_CLIENT_ID"] = originalClientId;
    if (originalClientSecret === undefined) delete process.env["AZURE_DEVOPS_OAUTH_CLIENT_SECRET"];
    else process.env["AZURE_DEVOPS_OAUTH_CLIENT_SECRET"] = originalClientSecret;
    if (originalTenantId === undefined) delete process.env["AZURE_DEVOPS_TENANT_ID"];
    else process.env["AZURE_DEVOPS_TENANT_ID"] = originalTenantId;
  });

  it("refreshes expired tokens and persists rotated credentials with compare-and-swap", async () => {
    mocks.refresh.mockResolvedValue({
      accessToken: "refreshed-access-token",
      refreshToken: "rotated-refresh-token",
      expiresIn: 3600,
      scope: ["vso.project", "vso.code"],
    });
    const originalEnvelope = encryptSourceControlCredentials({
      accessToken: "expired-access-token",
      refreshToken: "expired-refresh-token",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const client = await createAzureDevOpsClient({
      id: "connection-1",
      organizationId: "org-1",
      active: true,
      credentialCiphertext: originalEnvelope,
      scopes: ["vso.project", "vso.code"],
      accountName: "contoso",
    });

    expect(client).toBeInstanceOf(AzureDevOpsClient);
    expect(mocks.refresh).toHaveBeenCalledWith({
      clientId: "client-id",
      clientSecret: "client-secret",
      tenantId: "organizations",
      refreshToken: "expired-refresh-token",
    });
    expect(mocks.updateMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        id: "connection-1",
        organizationId: "org-1",
        provider: "AZURE_DEVOPS",
        active: true,
        credentialCiphertext: originalEnvelope,
      },
      data: { scopes: ["vso.project", "vso.code"] },
    });
    expect(mocks.updateMany.mock.calls[0]?.[0].data.credentialCiphertext).not.toBe(
      originalEnvelope,
    );
  });

  it("rejects disconnected connections and grants without the read-only scopes", async () => {
    await expect(
      createAzureDevOpsClient({
        id: "inactive",
        organizationId: "org-1",
        active: false,
        credentialCiphertext: "not-decrypted",
        scopes: ["vso.project", "vso.code"],
        accountName: "contoso",
      }),
    ).rejects.toBeInstanceOf(SourceControlProviderError);
    await expect(
      createAzureDevOpsClient({
        id: "under-scoped",
        organizationId: "org-1",
        active: true,
        credentialCiphertext: "not-decrypted",
        scopes: ["vso.project"],
        accountName: "contoso",
      }),
    ).rejects.toThrow("Azure DevOps authorization is missing required read-only scopes.");
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
