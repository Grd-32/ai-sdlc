import { createHash } from "node:crypto";
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

vi.mock("./queue.js", () => ({
  enqueuePullRequestAnalysis: mocks.enqueueAnalysis,
  enqueueSourceControlWebhookEvent: mocks.enqueueWebhook,
}));

const { GitLabWebhookAuthenticationError, ingestGitLabWebhookDelivery } =
  await import("./gitlab-webhooks.js");

const secret = "one-time-gitlab-secret";
const headers = {
  "x-gitlab-token": secret,
  "x-gitlab-event": "Merge Request Hook",
  "x-gitlab-event-uuid": "event-uuid-1",
};
const payload = JSON.stringify({
  user: { username: "developer" },
  project: { id: 42, path_with_namespace: "group/service" },
  object_attributes: {
    id: 5001,
    iid: 17,
    action: "open",
    state: "opened",
    title: "Add feature",
    source_branch: "feature",
    target_branch: "main",
    created_at: "2026-10-14T10:00:00.000Z",
    updated_at: "2026-10-14T10:05:00.000Z",
    merged_at: null,
    last_commit: { id: "head-sha-1" },
  },
});

describe("GitLab webhook ingestion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connectionFindFirst.mockResolvedValue({
      id: "connection-1",
      organizationId: "org-1",
      webhookSecretHash: createHash("sha256").update(secret).digest("hex"),
    });
    mocks.repositoryFindFirst.mockResolvedValue({
      id: "repository-1",
      organizationId: "org-1",
      sourceControlConnectionId: "connection-1",
    });
    mocks.pullRequestFindFirst.mockResolvedValue(null);
    mocks.pullRequestCreate.mockResolvedValue({ id: "pull-request-1" });
    mocks.pullRequestUpdateMany.mockResolvedValue({ count: 1 });
    mocks.commitUpsert.mockResolvedValue({ id: "commit-1" });
    mocks.webhookCreate.mockResolvedValue({
      id: "delivery-1",
      status: "RECEIVED",
      eventType: "Merge Request Hook",
      payloadHash: "payload-hash",
    });
    mocks.webhookFindUnique.mockResolvedValue(null);
    mocks.webhookUpdate.mockResolvedValue({ id: "delivery-1", status: "QUEUED" });
    mocks.webhookUpdateMany.mockResolvedValue({ count: 1 });
    mocks.enqueueAnalysis.mockResolvedValue("analysis-job-1");
    mocks.enqueueWebhook.mockResolvedValue("webhook-job-1");
  });

  it("authenticates, persists only a linked merge request, and queues shared analysis", async () => {
    const result = await ingestGitLabWebhookDelivery(payload, headers);

    expect(result).toMatchObject({
      eventId: "delivery-1",
      jobId: "webhook-job-1",
      status: "QUEUED",
      duplicate: false,
    });
    expect(mocks.connectionFindFirst).toHaveBeenCalledWith({
      where: {
        provider: "GITLAB",
        active: true,
        webhookSecretHash: createHash("sha256").update(secret).digest("hex"),
      },
      select: { id: true, organizationId: true, webhookSecretHash: true },
    });
    expect(mocks.repositoryFindFirst.mock.calls[0]?.[0]).toMatchObject({
      where: {
        organizationId: "org-1",
        provider: "GITLAB",
        sourceControlConnectionId: "connection-1",
        externalId: "42",
        enabled: true,
      },
    });
    expect(mocks.pullRequestCreate.mock.calls[0]?.[0]).toMatchObject({
      data: {
        organizationId: "org-1",
        repositoryId: "repository-1",
        provider: "GITLAB",
        externalId: "5001",
        number: 17,
        headSha: "head-sha-1",
      },
    });
    expect(mocks.enqueueAnalysis).toHaveBeenCalledWith({
      organizationId: "org-1",
      repositoryId: "repository-1",
      pullRequestId: "pull-request-1",
    });
  });

  it("rejects a token that does not match an active GitLab connection", async () => {
    mocks.connectionFindFirst.mockResolvedValue(null);

    await expect(
      ingestGitLabWebhookDelivery(payload, { ...headers, "x-gitlab-token": "invalid" }),
    ).rejects.toBeInstanceOf(GitLabWebhookAuthenticationError);
    expect(mocks.webhookCreate).not.toHaveBeenCalled();
  });

  it("ignores projects that are not explicitly linked to the connection", async () => {
    mocks.repositoryFindFirst.mockResolvedValue(null);

    const result = await ingestGitLabWebhookDelivery(payload, headers);

    expect(result).toMatchObject({ ignored: true, status: "IGNORED_UNSELECTED_PROJECT" });
    expect(mocks.webhookCreate).not.toHaveBeenCalled();
    expect(mocks.enqueueAnalysis).not.toHaveBeenCalled();
  });

  it("does not roll back a pull request when an older delivery arrives", async () => {
    mocks.pullRequestFindFirst.mockResolvedValue({
      id: "pull-request-1",
      updatedAt: new Date("2026-10-14T10:10:00.000Z"),
    });
    mocks.pullRequestUpdateMany.mockResolvedValue({ count: 0 });

    const result = await ingestGitLabWebhookDelivery(payload, headers);

    expect(result.status).toBe("STALE");
    expect(mocks.enqueueAnalysis).not.toHaveBeenCalled();
    expect(mocks.pullRequestUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "pull-request-1",
          updatedAt: { lte: new Date("2026-10-14T10:05:00.000Z") },
        },
      }),
    );
  });

  it("treats identical event UUID deliveries as idempotent", async () => {
    mocks.webhookCreate.mockRejectedValueOnce(
      Object.assign(new Error("unique constraint"), { code: "P2002" }),
    );
    mocks.webhookFindUnique.mockResolvedValue({
      id: "delivery-1",
      status: "COMPLETED",
      eventType: "Merge Request Hook",
      payloadHash: createHash("sha256").update(payload).digest("hex"),
    });

    const result = await ingestGitLabWebhookDelivery(payload, headers);

    expect(result).toMatchObject({ eventId: "delivery-1", status: "COMPLETED", duplicate: true });
    expect(mocks.enqueueAnalysis).not.toHaveBeenCalled();
    expect(mocks.enqueueWebhook).not.toHaveBeenCalled();
  });
});
