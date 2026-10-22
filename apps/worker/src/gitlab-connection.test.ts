import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn<
    (args: {
      where: {
        id: string;
        organizationId: string;
        provider: "GITLAB";
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
  return { ...actual, refreshGitLabOAuthToken: mocks.refresh };
});

const { encryptGitLabCredentials, GitLabClient, SourceControlProviderError } =
  await import("@ai-sdlc/source-control");
const { createGitLabClient } = await import("./gitlab-connection.js");

describe("worker GitLab connection credentials", () => {
  const originalEncryptionKey = process.env["SOURCE_CONTROL_ENCRYPTION_KEY"];
  const originalClientId = process.env["GITLAB_OAUTH_CLIENT_ID"];
  const originalClientSecret = process.env["GITLAB_OAUTH_CLIENT_SECRET"];

  beforeEach(() => {
    vi.clearAllMocks();
    process.env["SOURCE_CONTROL_ENCRYPTION_KEY"] = Buffer.alloc(32, 7).toString("base64");
    process.env["GITLAB_OAUTH_CLIENT_ID"] = "client-id";
    process.env["GITLAB_OAUTH_CLIENT_SECRET"] = "client-secret";
    mocks.updateMany.mockResolvedValue({ count: 1 });
  });

  afterEach(() => {
    if (originalEncryptionKey === undefined) delete process.env["SOURCE_CONTROL_ENCRYPTION_KEY"];
    else process.env["SOURCE_CONTROL_ENCRYPTION_KEY"] = originalEncryptionKey;
    if (originalClientId === undefined) delete process.env["GITLAB_OAUTH_CLIENT_ID"];
    else process.env["GITLAB_OAUTH_CLIENT_ID"] = originalClientId;
    if (originalClientSecret === undefined) delete process.env["GITLAB_OAUTH_CLIENT_SECRET"];
    else process.env["GITLAB_OAUTH_CLIENT_SECRET"] = originalClientSecret;
  });

  it("refreshes expired tokens and atomically persists the rotated encrypted credentials", async () => {
    mocks.refresh.mockResolvedValue({
      accessToken: "refreshed-access-token",
      refreshToken: "rotated-refresh-token",
      expiresIn: 3600,
      scope: ["read_user", "read_api", "read_repository"],
    });
    const originalEnvelope = encryptGitLabCredentials({
      accessToken: "expired-access-token",
      refreshToken: "expired-refresh-token",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const client = await createGitLabClient({
      id: "connection-1",
      organizationId: "org-1",
      active: true,
      credentialCiphertext: originalEnvelope,
      scopes: ["read_user", "read_api", "read_repository"],
    });

    expect(client).toBeInstanceOf(GitLabClient);
    expect(mocks.refresh).toHaveBeenCalledWith({
      clientId: "client-id",
      clientSecret: "client-secret",
      refreshToken: "expired-refresh-token",
    });
    const updateArgs = mocks.updateMany.mock.calls[0]?.[0];
    expect(updateArgs?.where).toEqual({
      id: "connection-1",
      organizationId: "org-1",
      provider: "GITLAB",
      active: true,
      credentialCiphertext: originalEnvelope,
    });
    expect(updateArgs?.data.scopes).toEqual(["read_user", "read_api", "read_repository"]);
    expect(updateArgs?.data.credentialCiphertext).not.toBe(originalEnvelope);
  });

  it("rejects inactive connections and connections without the required read-only scopes", async () => {
    await expect(
      createGitLabClient({
        id: "inactive",
        organizationId: "org-1",
        active: false,
        credentialCiphertext: "not-decrypted",
        scopes: ["read_user", "read_api", "read_repository"],
      }),
    ).rejects.toBeInstanceOf(SourceControlProviderError);
    await expect(
      createGitLabClient({
        id: "under-scoped",
        organizationId: "org-1",
        active: true,
        credentialCiphertext: "not-decrypted",
        scopes: ["read_user", "read_api"],
      }),
    ).rejects.toThrow("GitLab authorization is missing required read-only scopes.");
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
