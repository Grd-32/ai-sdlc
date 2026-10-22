import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn<
    (args: {
      where: {
        id: string;
        organizationId: string;
        provider: "BITBUCKET";
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
  return { ...actual, refreshBitbucketOAuthToken: mocks.refresh };
});

const { BitbucketClient, encryptSourceControlCredentials, SourceControlProviderError } =
  await import("@ai-sdlc/source-control");
const { createBitbucketClient } = await import("./bitbucket-connection.js");

describe("worker Bitbucket connection credentials", () => {
  const originalEncryptionKey = process.env["SOURCE_CONTROL_ENCRYPTION_KEY"];
  const originalClientId = process.env["BITBUCKET_OAUTH_CLIENT_ID"];
  const originalClientSecret = process.env["BITBUCKET_OAUTH_CLIENT_SECRET"];

  beforeEach(() => {
    vi.clearAllMocks();
    process.env["SOURCE_CONTROL_ENCRYPTION_KEY"] = Buffer.alloc(32, 9).toString("base64");
    process.env["BITBUCKET_OAUTH_CLIENT_ID"] = "client-id";
    process.env["BITBUCKET_OAUTH_CLIENT_SECRET"] = "client-secret";
    mocks.updateMany.mockResolvedValue({ count: 1 });
  });

  afterEach(() => {
    if (originalEncryptionKey === undefined) delete process.env["SOURCE_CONTROL_ENCRYPTION_KEY"];
    else process.env["SOURCE_CONTROL_ENCRYPTION_KEY"] = originalEncryptionKey;
    if (originalClientId === undefined) delete process.env["BITBUCKET_OAUTH_CLIENT_ID"];
    else process.env["BITBUCKET_OAUTH_CLIENT_ID"] = originalClientId;
    if (originalClientSecret === undefined) delete process.env["BITBUCKET_OAUTH_CLIENT_SECRET"];
    else process.env["BITBUCKET_OAUTH_CLIENT_SECRET"] = originalClientSecret;
  });

  it("refreshes expired tokens and atomically persists the rotated encrypted credentials", async () => {
    mocks.refresh.mockResolvedValue({
      accessToken: "refreshed-access-token",
      refreshToken: "rotated-refresh-token",
      expiresIn: 3600,
      scopes: ["account", "repository", "pullrequest"],
    });
    const originalEnvelope = encryptSourceControlCredentials({
      accessToken: "expired-access-token",
      refreshToken: "expired-refresh-token",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const client = await createBitbucketClient({
      id: "connection-1",
      organizationId: "org-1",
      active: true,
      credentialCiphertext: originalEnvelope,
      scopes: ["account", "repository", "pullrequest"],
    });

    expect(client).toBeInstanceOf(BitbucketClient);
    expect(mocks.refresh).toHaveBeenCalledWith({
      clientId: "client-id",
      clientSecret: "client-secret",
      refreshToken: "expired-refresh-token",
    });
    const updateArgs = mocks.updateMany.mock.calls[0]?.[0];
    expect(updateArgs?.where).toEqual({
      id: "connection-1",
      organizationId: "org-1",
      provider: "BITBUCKET",
      active: true,
      credentialCiphertext: originalEnvelope,
    });
    expect(updateArgs?.data.scopes).toEqual(["account", "repository", "pullrequest"]);
    expect(updateArgs?.data.credentialCiphertext).not.toBe(originalEnvelope);
  });

  it("uses the latest stored credentials when another worker wins the refresh race", async () => {
    mocks.refresh.mockResolvedValue({
      accessToken: "losing-access-token",
      refreshToken: "losing-refresh-token",
      expiresIn: 3600,
      scopes: ["account", "repository", "pullrequest"],
    });
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findFirst.mockImplementation(() =>
      Promise.resolve({
        credentialCiphertext: encryptSourceControlCredentials({
          accessToken: "winning-access-token",
          refreshToken: "winning-refresh-token",
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        }),
        scopes: ["account", "repository", "pullrequest"],
      }),
    );
    const expiredEnvelope = encryptSourceControlCredentials({
      accessToken: "expired-access-token",
      refreshToken: "expired-refresh-token",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    await expect(
      createBitbucketClient({
        id: "connection-1",
        organizationId: "org-1",
        active: true,
        credentialCiphertext: expiredEnvelope,
        scopes: ["account", "repository", "pullrequest"],
      }),
    ).resolves.toBeInstanceOf(BitbucketClient);
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: {
        id: "connection-1",
        organizationId: "org-1",
        provider: "BITBUCKET",
        active: true,
      },
      select: { credentialCiphertext: true, scopes: true },
    });
  });

  it("rejects inactive connections and connections missing read-only scopes", async () => {
    await expect(
      createBitbucketClient({
        id: "inactive",
        organizationId: "org-1",
        active: false,
        credentialCiphertext: "not-decrypted",
        scopes: ["account", "repository", "pullrequest"],
      }),
    ).rejects.toBeInstanceOf(SourceControlProviderError);
    await expect(
      createBitbucketClient({
        id: "under-scoped",
        organizationId: "org-1",
        active: true,
        credentialCiphertext: "not-decrypted",
        scopes: ["account", "repository"],
      }),
    ).rejects.toThrow("Bitbucket authorization is missing required read-only scopes.");
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
