import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../types.js";

const mocks = vi.hoisted(() => ({
  getGithubQueue: vi.fn(),
  getRedisConnection: vi.fn(),
}));

vi.mock("../queue.js", () => ({
  getGithubQueue: mocks.getGithubQueue,
  getRedisConnection: mocks.getRedisConnection,
}));
vi.mock("../config.js", () => ({ QUEUE_NAMES: { GITHUB: "github" } }));

const { registerQueueOperationsRoutes } = await import("./queue-operations.js");
const priorToken = process.env["QUEUE_OPERATIONS_TOKEN"];
const app = new Hono<AppEnv>();
registerQueueOperationsRoutes(app);

describe("internal queue operations", () => {
  beforeEach(() => {
    process.env["QUEUE_OPERATIONS_TOKEN"] = "test-operations-token";
    mocks.getGithubQueue.mockReset();
    mocks.getRedisConnection.mockReset();
  });

  afterEach(() => {
    if (priorToken === undefined) delete process.env["QUEUE_OPERATIONS_TOKEN"];
    else process.env["QUEUE_OPERATIONS_TOKEN"] = priorToken;
  });

  it("rejects missing or invalid operator tokens before querying queue data", async () => {
    const missing = await app.request("/internal/operations/queue");
    expect(missing.status).toBe(401);

    const invalid = await app.request("/internal/operations/queue", {
      headers: { authorization: "Bearer wrong-token" },
    });
    expect(invalid.status).toBe(401);
    expect(mocks.getGithubQueue).not.toHaveBeenCalled();
  });

  it("returns bounded queue, failure, stalled-event and worker heartbeat data", async () => {
    mocks.getGithubQueue.mockReturnValue({
      getJobCounts: vi.fn().mockResolvedValue({
        waiting: 1,
        active: 1,
        delayed: 0,
        failed: 1,
        completed: 10,
        paused: 0,
      }),
      getJobs: vi.fn().mockImplementation((states: string[]) => {
        if (states[0] === "waiting") {
          return Promise.resolve([{ id: "oldest", name: "analyze", timestamp: Date.now() - 60_000 }]);
        }
        if (states[0] === "active") {
          return Promise.resolve([{ id: "active-1", name: "webhook", timestamp: Date.now() - 1_000 }]);
        }
        return Promise.resolve([{
          id: "failed-1",
          name: "assessment",
          timestamp: Date.now() - 10_000,
          finishedOn: Date.now() - 5_000,
        }]);
      }),
    });
    mocks.getRedisConnection.mockReturnValue({
      get: vi.fn().mockImplementation((key: string) => {
        if (key.endsWith("worker:heartbeat")) {
          const now = new Date().toISOString();
          return Promise.resolve(JSON.stringify({ instanceId: "worker-1", startedAt: now, lastSeenAt: now }));
        }
        if (key.endsWith("stalled-count")) return Promise.resolve("2");
        if (key.endsWith("stalled-last-seen")) return Promise.resolve("2026-10-21T00:00:00.000Z");
        return Promise.resolve(null);
      }),
    });

    const response = await app.request("/internal/operations/queue", {
      headers: { authorization: "Bearer test-operations-token" },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        counts: { waiting: number };
        oldestWaitingJob: { id: string };
        recentFailures: { id: string }[];
        stalledEvents: { count: number };
        worker: { status: string; instanceId: string };
      };
    };
    expect(body.data.counts.waiting).toBe(1);
    expect(body.data.oldestWaitingJob.id).toBe("oldest");
    expect(body.data.recentFailures[0]?.id).toBe("failed-1");
    expect(body.data.stalledEvents.count).toBe(2);
    expect(body.data.worker).toMatchObject({ status: "HEALTHY", instanceId: "worker-1" });
  });
});
