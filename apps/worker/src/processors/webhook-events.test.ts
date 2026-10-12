import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";

const dbMocks = vi.hoisted(() => ({
  updateMany: vi.fn(),
}));
const updateCalls: Array<{
  where: { provider: string; deliveryId: string };
  data: { status: string; processedAt: Date | null };
}> = [];

vi.mock("@ai-sdlc/db", () => ({
  prisma: { gitHubWebhookEvent: { updateMany: dbMocks.updateMany } },
  checkDatabaseConnection: vi.fn(),
}));

vi.mock("./analyze.js", () => ({ processPullRequestAnalyze: vi.fn() }));
vi.mock("./retention.js", () => ({ processRetentionCleanup: vi.fn() }));

import { JOB_TYPES, WEBHOOK_STATUS } from "../config.js";
import { processGitHubWebhookEvent, type GitHubWebhookEventJobData } from "./index.js";

function webhookJob(attemptsMade: number, attempts: number): Job<GitHubWebhookEventJobData> {
  return {
    id: "job-1",
    name: JOB_TYPES.GITHUB_WEBHOOK_EVENT,
    data: {
      eventType: "issues",
      deliveryId: "delivery-1",
      payloadHash: "payload-hash",
      payload: {},
      enqueuedAt: new Date().toISOString(),
    } satisfies GitHubWebhookEventJobData,
    opts: { attempts },
    attemptsMade,
  } as unknown as Job<GitHubWebhookEventJobData>;
}

describe("webhook event retry lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateCalls.length = 0;
    dbMocks.updateMany.mockImplementation(
      (args: {
        where: { provider: string; deliveryId: string };
        data: { status: string; processedAt: Date | null };
      }) => {
        updateCalls.push(args);
        if (updateCalls.length === 2) {
          return Promise.reject(new Error("database temporarily unavailable"));
        }
        return Promise.resolve({ count: 1 });
      },
    );
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  it("marks a failed attempt as retrying until BullMQ exhausts attempts", async () => {
    await expect(processGitHubWebhookEvent(webhookJob(0, 5))).rejects.toThrow(
      "Webhook delivery delivery-1 failed",
    );

    expect(updateCalls[0]?.data).toEqual({
      status: WEBHOOK_STATUS.PROCESSING,
      processedAt: null,
    });
    expect(updateCalls[2]?.data).toEqual({
      status: WEBHOOK_STATUS.RETRYING,
      processedAt: null,
    });
  });

  it("marks the final failed attempt terminal", async () => {
    updateCalls.length = 0;
    dbMocks.updateMany.mockImplementation(
      (args: {
        where: { provider: string; deliveryId: string };
        data: { status: string; processedAt: Date | null };
      }) => {
        updateCalls.push(args);
        if (updateCalls.length === 2) {
          return Promise.reject(new Error("permanent processing failure"));
        }
        return Promise.resolve({ count: 1 });
      },
    );

    await expect(processGitHubWebhookEvent(webhookJob(4, 5))).rejects.toThrow(
      "Webhook delivery delivery-1 failed",
    );

    expect(updateCalls[2]?.data.status).toBe(WEBHOOK_STATUS.FAILED);
    expect(updateCalls[2]?.data.processedAt).toBeInstanceOf(Date);
  });
});
