import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectionFindFirst: vi.fn(),
  repositoryFindFirst: vi.fn(),
  pullRequestFindFirst: vi.fn(),
  pullRequestCreate: vi.fn(),
  pullRequestUpdateMany: vi.fn(),
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
  AzureDevOpsWebhookAuthenticationError,
  AzureDevOpsWebhookDeliveryConflictError,
  ingestAzureDevOpsWebhookDelivery,
} = await import("./azure-devops-webhooks.js");

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
const eventId = "a0a0a0a0-bbbb-cccc-dddd-e1e1e1e1e1e1";

function makePayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: eventId,
    eventType: "git.pullrequest.created",
    createdDate: "2026-10-14T12:00:00.000Z",
    resource: {
      pullRequestId: 17,
      status: "active",
      title: "Add guarded login",
      creationDate: "2026-10-12T12:00:00.000Z",
      sourceRefName: "refs/heads/feature/login",
      targetRefName: "refs/heads/main",
      lastMergeSourceCommit: { commitId: "head-sha-17" },
      createdBy: { uniqueName: "developer@example.test", displayName: "Developer" },
      repository: {
        id: "repo-azure-1",
        name: "service",
        project: { id: "project-1", name: "platform" },
      },
    },
    ...overrides,
  });
}

function authorization(password = "webhook-secret"): string {
  return `Basic ${Buffer.from(`ai-sdlc:${password}`).toString("base64")}`;
}

describe("Azure DevOps Service Hook delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connectionFindFirst.mockResolvedValue(connection);
    mocks.decryptSecret.mockReturnValue("webhook-secret");
    mocks.repositoryFindFirst.mockResolvedValue(repository);
    mocks.pullRequestFindFirst.mockResolvedValue(null);
    mocks.pullRequestCreate.mockResolvedValue({ id: "pull-request-1" });
    mocks.pullRequestUpdateMany.mockResolvedValue({ count: 1 });
    mocks.webhookCreate.mockResolvedValue({
      id: "delivery-1",
      status: "RECEIVED",
      eventType: "git.pullrequest.created",
      payloadHash: "payload-hash",
    });
    mocks.webhookUpdate.mockResolvedValue({ id: "delivery-1", status: "QUEUED" });
    mocks.webhookUpdateMany.mockResolvedValue({ count: 1 });
    mocks.enqueueAnalysis.mockResolvedValue("analysis-job-1");
    mocks.enqueueWebhook.mockResolvedValue("webhook-job-1");
  });

  it("authenticates, scopes, persists sanitized PR metadata, and enqueues analysis", async () => {
    const payload = makePayload();
    const result = await ingestAzureDevOpsWebhookDelivery("connection-1", payload, authorization());

    expect(result).toMatchObject({
      eventId: "delivery-1",
      jobId: "webhook-job-1",
      status: "QUEUED",
      duplicate: false,
    });
    expect(mocks.connectionFindFirst).toHaveBeenCalledWith({
      where: { id: "connection-1", provider: "AZURE_DEVOPS", active: true },
      select: { id: true, organizationId: true, webhookSecretCiphertext: true },
    });
    expect(mocks.repositoryFindFirst).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        provider: "AZURE_DEVOPS",
        sourceControlConnectionId: "connection-1",
        externalId: "repo-azure-1",
        enabled: true,
      },
      select: { id: true, organizationId: true, sourceControlConnectionId: true },
    });
    const webhookCall = JSON.stringify(mocks.webhookCreate.mock.calls);
    expect(webhookCall).toContain('"provider":"AZURE_DEVOPS"');
    expect(webhookCall).toContain('"eventType":"git.pullrequest.created"');
    expect(webhookCall).toContain('"headSha":"head-sha-17"');
    expect(webhookCall).not.toContain("Add guarded login");
    expect(JSON.stringify(mocks.pullRequestCreate.mock.calls)).toContain('"externalId":"17"');
    expect(mocks.enqueueAnalysis).toHaveBeenCalledWith({
      organizationId: "org-1",
      repositoryId: "repository-1",
      pullRequestId: "pull-request-1",
    });
  });

  it("rejects invalid Basic credentials before parsing or persisting the event", async () => {
    await expect(
      ingestAzureDevOpsWebhookDelivery("connection-1", "not-json", authorization("wrong")),
    ).rejects.toBeInstanceOf(AzureDevOpsWebhookAuthenticationError);
    expect(mocks.webhookCreate).not.toHaveBeenCalled();
  });

  it("ignores an authenticated Service Hook test request", async () => {
    const payload = JSON.stringify({ eventType: "servicehook.test" });
    const result = await ingestAzureDevOpsWebhookDelivery("connection-1", payload, authorization());

    expect(result).toMatchObject({ status: "TEST_ACKNOWLEDGED", ignored: true, duplicate: false });
    expect(mocks.webhookCreate).not.toHaveBeenCalled();
  });

  it("does not persist events for repositories that are not selected", async () => {
    mocks.repositoryFindFirst.mockResolvedValueOnce(null);
    const result = await ingestAzureDevOpsWebhookDelivery(
      "connection-1",
      makePayload(),
      authorization(),
    );

    expect(result).toMatchObject({ status: "IGNORED_UNSELECTED_REPOSITORY", ignored: true });
    expect(mocks.webhookCreate).not.toHaveBeenCalled();
  });

  it("deduplicates an exact event redelivery", async () => {
    const payload = makePayload();
    const payloadHash = createHash("sha256").update(payload).digest("hex");
    mocks.webhookCreate.mockRejectedValueOnce({ code: "P2002" });
    mocks.webhookFindUnique.mockResolvedValueOnce({
      id: "delivery-existing",
      status: "QUEUED",
      eventType: "git.pullrequest.created",
      payloadHash,
    });

    const result = await ingestAzureDevOpsWebhookDelivery("connection-1", payload, authorization());

    expect(result).toMatchObject({
      eventId: "delivery-existing",
      status: "QUEUED",
      duplicate: true,
    });
    expect(mocks.pullRequestCreate).not.toHaveBeenCalled();
  });

  it("rejects reuse of an event UUID with a different payload", async () => {
    mocks.webhookCreate.mockRejectedValueOnce({ code: "P2002" });
    mocks.webhookFindUnique.mockResolvedValueOnce({
      id: "delivery-existing",
      status: "QUEUED",
      eventType: "git.pullrequest.created",
      payloadHash: "different-hash",
    });

    await expect(
      ingestAzureDevOpsWebhookDelivery("connection-1", makePayload(), authorization()),
    ).rejects.toBeInstanceOf(AzureDevOpsWebhookDeliveryConflictError);
  });

  it("marks out-of-order updates stale and does not enqueue analysis", async () => {
    mocks.pullRequestFindFirst.mockResolvedValueOnce({
      id: "pull-request-existing",
      updatedAt: new Date("2026-10-15T00:00:00.000Z"),
    });
    mocks.pullRequestUpdateMany.mockResolvedValueOnce({ count: 0 });
    const result = await ingestAzureDevOpsWebhookDelivery(
      "connection-1",
      makePayload({ eventType: "git.pullrequest.updated" }),
      authorization(),
    );

    expect(result).toMatchObject({ status: "STALE", duplicate: false });
    expect(JSON.stringify(mocks.webhookUpdate.mock.calls)).toContain('"status":"STALE"');
    expect(mocks.enqueueAnalysis).not.toHaveBeenCalled();
  });

  it("marks processing failure retryable when queueing fails", async () => {
    mocks.enqueueAnalysis.mockRejectedValueOnce(new Error("queue unavailable"));

    await expect(
      ingestAzureDevOpsWebhookDelivery("connection-1", makePayload(), authorization()),
    ).rejects.toThrow("queue unavailable");

    expect(JSON.stringify(mocks.webhookUpdate.mock.calls)).toContain('"status":"FAILED"');
  });
});
