import { createHash, createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectionFindFirst: vi.fn(),
  repositoryFindFirst: vi.fn(),
  pullRequestFindFirst: vi.fn(),
  pullRequestCreate: vi.fn(),
  pullRequestUpdateMany: vi.fn(),
  commitUpsert: vi.fn(),
  webhookCreate: vi.fn(),
  webhookFindUnique: vi.fn(),
  webhookUpdate: vi.fn(),
  webhookUpdateMany: vi.fn(),
  enqueueAnalysis: vi.fn(),
  enqueueWebhook: vi.fn(),
  decryptSecret: vi.fn(),
}));

vi.mock("@ai-sdlc/db", () => ({
  prisma: {
    sourceControlConnection: { findFirst: mocks.connectionFindFirst },
    repository: { findFirst: mocks.repositoryFindFirst },
    pullRequest: {
      findFirst: mocks.pullRequestFindFirst,
      create: mocks.pullRequestCreate,
      updateMany: mocks.pullRequestUpdateMany,
    },
    commit: { upsert: mocks.commitUpsert },
    gitHubWebhookEvent: {
      create: mocks.webhookCreate,
      findUnique: mocks.webhookFindUnique,
      update: mocks.webhookUpdate,
      updateMany: mocks.webhookUpdateMany,
    },
  },
}));

vi.mock("@ai-sdlc/source-control", () => ({
  decryptSourceControlSecret: mocks.decryptSecret,
}));

vi.mock("./queue.js", () => ({
  enqueuePullRequestAnalysis: mocks.enqueueAnalysis,
  enqueueSourceControlWebhookEvent: mocks.enqueueWebhook,
}));

const {
  BitbucketWebhookAuthenticationError,
  BitbucketWebhookDeliveryConflictError,
  ingestBitbucketWebhookDelivery,
} = await import("./bitbucket-webhooks.js");

const connection = {
  id: "connection-1",
  organizationId: "org-1",
  webhookSecretCiphertext: "encrypted",
};
const repository = {
  id: "repository-1",
  organizationId: "org-1",
  sourceControlConnectionId: "connection-1",
};

function makePayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    repository: { uuid: "{repo-uuid}", full_name: "acme/service" },
    pullrequest: {
      id: 17,
      title: "Add guarded login",
      state: "OPEN",
      author: { nickname: "developer" },
      source: {
        branch: { name: "feature/login" },
        commit: { hash: "head-sha-17" },
      },
      destination: { branch: { name: "main" } },
      created_on: "2026-10-12T12:00:00.000Z",
      updated_on: "2026-10-14T12:00:00.000Z",
    },
    ...overrides,
  });
}

function signedHeaders(
  payload: string,
  eventType = "pullrequest:created",
  requestUuid = "request-uuid-1",
): Record<string, string> {
  return {
    "x-event-key": eventType,
    "x-request-uuid": requestUuid,
    "x-hub-signature": `sha256=${createHmac("sha256", "webhook-secret").update(payload).digest("hex")}`,
  };
}

describe("Bitbucket webhook delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connectionFindFirst.mockResolvedValue(connection);
    mocks.decryptSecret.mockReturnValue("webhook-secret");
    mocks.repositoryFindFirst.mockResolvedValue(repository);
    mocks.pullRequestFindFirst.mockResolvedValue(null);
    mocks.pullRequestCreate.mockResolvedValue({ id: "pull-request-1" });
    mocks.pullRequestUpdateMany.mockResolvedValue({ count: 1 });
    mocks.commitUpsert.mockResolvedValue({ id: "commit-1" });
    mocks.webhookCreate.mockResolvedValue({
      id: "delivery-1",
      status: "RECEIVED",
      eventType: "pullrequest:created",
      payloadHash: "payload-hash",
    });
    mocks.webhookUpdate.mockResolvedValue({ id: "delivery-1", status: "QUEUED" });
    mocks.webhookUpdateMany.mockResolvedValue({ count: 1 });
    mocks.enqueueAnalysis.mockResolvedValue("analysis-job-1");
    mocks.enqueueWebhook.mockResolvedValue("webhook-job-1");
  });

  it("authenticates, scopes, deduplicates, persists sanitized PR metadata, and enqueues analysis", async () => {
    const payload = makePayload();
    const result = await ingestBitbucketWebhookDelivery(
      "connection-1",
      payload,
      signedHeaders(payload),
    );

    expect(result).toMatchObject({
      eventId: "delivery-1",
      jobId: "webhook-job-1",
      status: "QUEUED",
      duplicate: false,
    });
    expect(mocks.connectionFindFirst).toHaveBeenCalledWith({
      where: { id: "connection-1", provider: "BITBUCKET", active: true },
      select: { id: true, organizationId: true, webhookSecretCiphertext: true },
    });
    expect(mocks.repositoryFindFirst).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        provider: "BITBUCKET",
        sourceControlConnectionId: "connection-1",
        externalId: "{repo-uuid}",
        enabled: true,
      },
      select: { id: true, organizationId: true, sourceControlConnectionId: true },
    });
    const webhookCall = JSON.stringify(mocks.webhookCreate.mock.calls);
    expect(webhookCall).toContain('"provider":"BITBUCKET"');
    expect(webhookCall).toContain('"organizationId":"org-1"');
    expect(webhookCall).toContain('"repositoryId":"repository-1"');
    expect(webhookCall).toContain('"eventType":"pullrequest:created"');
    expect(webhookCall).toContain('"repositoryUuid":"{repo-uuid}"');
    expect(webhookCall).toContain('"pullRequestId":17');
    expect(webhookCall).toContain('"headSha":"head-sha-17"');
    expect(webhookCall).not.toContain("Add guarded login");
    const pullRequestCall = JSON.stringify(mocks.pullRequestCreate.mock.calls);
    expect(pullRequestCall).toContain('"externalId":"17"');
    expect(pullRequestCall).toContain('"authorLogin":"developer"');
    expect(mocks.commitUpsert).toHaveBeenCalledOnce();
    expect(mocks.enqueueAnalysis).toHaveBeenCalledWith({
      organizationId: "org-1",
      repositoryId: "repository-1",
      pullRequestId: "pull-request-1",
    });
    expect(mocks.enqueueWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "BITBUCKET", eventType: "pullrequest:created" }),
    );
  });

  it("rejects invalid HMAC signatures before examining or persisting the payload", async () => {
    const payload = makePayload();
    await expect(
      ingestBitbucketWebhookDelivery("connection-1", payload, {
        ...signedHeaders(payload),
        "x-hub-signature": `sha256=${"0".repeat(64)}`,
      }),
    ).rejects.toBeInstanceOf(BitbucketWebhookAuthenticationError);
    expect(mocks.repositoryFindFirst).not.toHaveBeenCalled();
    expect(mocks.webhookCreate).not.toHaveBeenCalled();
  });

  it("ignores repositories not explicitly selected for this connection", async () => {
    mocks.repositoryFindFirst.mockResolvedValueOnce(null);
    const payload = makePayload();
    await expect(
      ingestBitbucketWebhookDelivery("connection-1", payload, signedHeaders(payload)),
    ).resolves.toMatchObject({
      status: "IGNORED_UNSELECTED_REPOSITORY",
      ignored: true,
    });
    expect(mocks.webhookCreate).not.toHaveBeenCalled();
    expect(mocks.pullRequestCreate).not.toHaveBeenCalled();
  });

  it("deduplicates identical provider delivery retries", async () => {
    const payload = makePayload();
    const payloadHash = createHash("sha256").update(payload).digest("hex");
    mocks.webhookCreate.mockRejectedValueOnce({ code: "P2002" });
    mocks.webhookFindUnique.mockResolvedValueOnce({
      id: "delivery-existing",
      status: "QUEUED",
      eventType: "pullrequest:created",
      payloadHash,
    });

    await expect(
      ingestBitbucketWebhookDelivery("connection-1", payload, signedHeaders(payload)),
    ).resolves.toMatchObject({
      eventId: "delivery-existing",
      status: "QUEUED",
      duplicate: true,
    });
    expect(mocks.pullRequestCreate).not.toHaveBeenCalled();
  });

  it("rejects a reused delivery UUID with a different payload", async () => {
    mocks.webhookCreate.mockRejectedValueOnce({ code: "P2002" });
    mocks.webhookFindUnique.mockResolvedValueOnce({
      id: "delivery-existing",
      status: "QUEUED",
      eventType: "pullrequest:created",
      payloadHash: "different-hash",
    });
    const payload = makePayload();
    await expect(
      ingestBitbucketWebhookDelivery("connection-1", payload, signedHeaders(payload)),
    ).rejects.toBeInstanceOf(BitbucketWebhookDeliveryConflictError);
  });

  it("marks out-of-order pull-request updates stale and does not enqueue analysis", async () => {
    mocks.pullRequestFindFirst.mockResolvedValueOnce({
      id: "pull-request-existing",
      updatedAt: new Date("2026-10-15T00:00:00.000Z"),
    });
    mocks.pullRequestUpdateMany.mockResolvedValueOnce({ count: 0 });
    const payload = makePayload();
    const result = await ingestBitbucketWebhookDelivery(
      "connection-1",
      payload,
      signedHeaders(payload, "pullrequest:updated"),
    );

    expect(result).toMatchObject({ status: "STALE", duplicate: false });
    expect(JSON.stringify(mocks.webhookUpdate.mock.calls)).toContain('"status":"STALE"');
    expect(mocks.enqueueAnalysis).not.toHaveBeenCalled();
  });

  it("marks failed processing retryable when job enqueue fails", async () => {
    mocks.enqueueAnalysis.mockRejectedValueOnce(new Error("queue unavailable"));
    const payload = makePayload();
    await expect(
      ingestBitbucketWebhookDelivery("connection-1", payload, signedHeaders(payload)),
    ).rejects.toThrow("queue unavailable");
    expect(JSON.stringify(mocks.webhookUpdate.mock.calls)).toContain('"status":"FAILED"');
  });
});
