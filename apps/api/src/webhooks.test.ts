import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  event: null as {
    id: string;
    status: string;
    eventType: string;
    payloadHash: string;
  } | null,
}));

const dbMocks = vi.hoisted(() => ({
  create: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  installationFindFirst: vi.fn(),
  enqueueWebhook: vi.fn(),
  enqueueAnalysis: vi.fn(),
}));

vi.mock("@ai-sdlc/db", () => ({
  prisma: {
    gitHubWebhookEvent: {
      create: dbMocks.create,
      findUnique: dbMocks.findUnique,
      update: dbMocks.update,
      updateMany: dbMocks.updateMany,
    },
    gitHubInstallation: { findFirst: dbMocks.installationFindFirst },
  },
  recordAuditEvent: vi.fn(),
}));

vi.mock("./queue.js", () => ({
  enqueueGitHubWebhookEvent: dbMocks.enqueueWebhook,
  enqueuePullRequestAnalysis: dbMocks.enqueueAnalysis,
  getGitHubWebhookEventJobId: vi.fn(() => "stable-job-id"),
}));

import { GitHubWebhookDeliveryConflictError, ingestGitHubWebhookDelivery } from "./webhooks.js";

describe("GitHub webhook delivery idempotency", () => {
  beforeEach(() => {
    state.event = null;
    vi.clearAllMocks();
    dbMocks.create.mockImplementation(
      ({ data }: { data: { eventType: string; deliveryId: string; payloadHash: string } }) => {
        if (state.event) {
          return Promise.reject(Object.assign(new Error("Unique constraint"), { code: "P2002" }));
        }
        state.event = {
          id: "event-1",
          status: "RECEIVED",
          eventType: data.eventType,
          payloadHash: data.payloadHash,
        };
        return Promise.resolve({ id: state.event.id, status: state.event.status });
      },
    );
    dbMocks.findUnique.mockImplementation(() => Promise.resolve(state.event));
    dbMocks.update.mockImplementation(({ data }: { data: { status?: string } }) => {
      if (!state.event) return Promise.reject(new Error("Expected a claimed webhook event"));
      state.event = { ...state.event, ...data };
      return Promise.resolve({ id: state.event.id, status: state.event.status });
    });
    dbMocks.updateMany.mockImplementation(
      ({ where, data }: { where: { status: string }; data: { status: string } }) => {
        if (!state.event || state.event.status !== where.status)
          return Promise.resolve({ count: 0 });
        state.event = { ...state.event, ...data };
        return Promise.resolve({ count: 1 });
      },
    );
    dbMocks.installationFindFirst.mockResolvedValue(null);
    dbMocks.enqueueWebhook.mockResolvedValue("stable-job-id");
    dbMocks.enqueueAnalysis.mockResolvedValue("analysis-job-id");
  });

  it("claims each delivery once and returns the existing record on an identical replay", async () => {
    const payload = JSON.stringify({ action: "created" });
    const headers = {
      "x-github-event": "issues",
      "x-github-delivery": "delivery-1",
    };

    const first = await ingestGitHubWebhookDelivery(payload, headers);
    const replay = await ingestGitHubWebhookDelivery(payload, headers);

    expect(first).toMatchObject({ eventId: "event-1", jobId: "stable-job-id", duplicate: false });
    expect(replay).toMatchObject({ eventId: first.eventId, jobId: first.jobId, duplicate: true });
    expect(dbMocks.create).toHaveBeenCalledTimes(2);
    expect(dbMocks.enqueueWebhook).toHaveBeenCalledTimes(1);
  });

  it("rejects reuse of a delivery ID with a different event payload", async () => {
    const headers = {
      "x-github-event": "issues",
      "x-github-delivery": "delivery-2",
    };

    await ingestGitHubWebhookDelivery(JSON.stringify({ action: "created" }), headers);

    await expect(
      ingestGitHubWebhookDelivery(JSON.stringify({ action: "deleted" }), headers),
    ).rejects.toBeInstanceOf(GitHubWebhookDeliveryConflictError);
    expect(dbMocks.enqueueWebhook).toHaveBeenCalledTimes(1);
  });

  it("allows a GitHub retry after the first processing attempt fails", async () => {
    const payload = JSON.stringify({ action: "created" });
    const headers = {
      "x-github-event": "issues",
      "x-github-delivery": "delivery-3",
    };
    dbMocks.enqueueWebhook.mockRejectedValueOnce(new Error("Redis unavailable"));

    await expect(ingestGitHubWebhookDelivery(payload, headers)).rejects.toThrow(
      "Redis unavailable",
    );
    const retry = await ingestGitHubWebhookDelivery(payload, headers);

    expect(retry).toMatchObject({ eventId: "event-1", duplicate: false });
    expect(dbMocks.updateMany).toHaveBeenCalledWith({
      where: { id: "event-1", status: "FAILED" },
      data: { status: "RECEIVED", processedAt: null },
    });
    expect(dbMocks.enqueueWebhook).toHaveBeenCalledTimes(2);
  });
});
