import { timingSafeEqual } from "node:crypto";
import type { Hono } from "hono";
import { QUEUE_NAMES } from "../config.js";
import { getGithubQueue, getRedisConnection } from "../queue.js";
import type { AppEnv } from "../types.js";

const keyPrefix = process.env["BULLMQ_PREFIX"] ? `${process.env["BULLMQ_PREFIX"]}:` : "";
const heartbeatKey = `${keyPrefix}nomalog:worker:heartbeat`;
const stalledCountKey = `${keyPrefix}nomalog:worker:stalled-count`;
const stalledLastSeenKey = `${keyPrefix}nomalog:worker:stalled-last-seen`;
const heartbeatFreshnessMs = 30_000;

type QueueJob = {
  id?: string;
  name: string;
  timestamp: number;
  processedOn?: number;
  finishedOn?: number;
};

function parseHeartbeat(value: string | null) {
  if (value === null) return null;
  const parsed: unknown = JSON.parse(value);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("instanceId" in parsed) ||
    typeof parsed.instanceId !== "string" ||
    !("startedAt" in parsed) ||
    typeof parsed.startedAt !== "string" ||
    !("lastSeenAt" in parsed) ||
    typeof parsed.lastSeenAt !== "string" ||
    !Number.isFinite(Date.parse(parsed.lastSeenAt)) ||
    !Number.isFinite(Date.parse(parsed.startedAt))
  ) {
    throw new Error("Worker heartbeat data is malformed.");
  }
  return {
    instanceId: parsed.instanceId,
    startedAt: parsed.startedAt,
    lastSeenAt: parsed.lastSeenAt,
  };
}

function summarizeJob(job: QueueJob) {
  return {
    id: job.id ?? "unknown",
    name: job.name,
    enqueuedAt: new Date(job.timestamp).toISOString(),
    ageSeconds: Math.max(0, Math.floor((Date.now() - job.timestamp) / 1000)),
  };
}

export function registerQueueOperationsRoutes(app: Hono<AppEnv>): void {
  app.get("/internal/operations/queue", async (c) => {
    const expectedToken = process.env["QUEUE_OPERATIONS_TOKEN"];
    const suppliedToken = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
    if (!expectedToken) {
      return c.json(
        {
          data: null,
          error: {
            code: "OPERATIONS_NOT_CONFIGURED",
            message: "Operations access is not configured.",
          },
        },
        503,
      );
    }
    if (
      !suppliedToken ||
      Buffer.byteLength(suppliedToken) !== Buffer.byteLength(expectedToken) ||
      !timingSafeEqual(Buffer.from(suppliedToken), Buffer.from(expectedToken))
    ) {
      return c.json(
        { data: null, error: { code: "UNAUTHORIZED", message: "Operations access denied." } },
        401,
      );
    }

    const queue = getGithubQueue();
    const redis = getRedisConnection();
    const [counts, waitingJobs, activeJobs, failedJobs, heartbeatValue, stalledCount, stalledAt] =
      await Promise.all([
        queue.getJobCounts("waiting", "active", "delayed", "failed", "completed", "paused"),
        queue.getJobs(["waiting"], 0, 0),
        queue.getJobs(["active"], 0, 9),
        queue.getJobs(["failed"], 0, 9),
        redis.get(heartbeatKey),
        redis.get(stalledCountKey),
        redis.get(stalledLastSeenKey),
      ]);

    const heartbeat = parseHeartbeat(heartbeatValue);
    const heartbeatAgeMs = heartbeat ? Date.now() - Date.parse(heartbeat.lastSeenAt) : null;
    const workerStatus =
      heartbeatAgeMs === null
        ? "NOT_SEEN"
        : heartbeatAgeMs <= heartbeatFreshnessMs
          ? "HEALTHY"
          : "STALE";

    const [oldestWaiting] = waitingJobs
      .slice()
      .sort((left, right) => left.timestamp - right.timestamp);
    const recentFailures = failedJobs
      .slice()
      .sort(
        (left, right) =>
          (right.finishedOn ?? right.timestamp) - (left.finishedOn ?? left.timestamp),
      )
      .map(summarizeJob);

    return c.json({
      data: {
        queue: QUEUE_NAMES.GITHUB,
        counts,
        oldestWaitingJob: oldestWaiting ? summarizeJob(oldestWaiting) : null,
        activeJobs: activeJobs.map(summarizeJob),
        recentFailures,
        stalledEvents: {
          count: Number(stalledCount ?? 0),
          lastSeenAt: stalledAt,
          scope: "Since this worker process started; resets on worker restart.",
        },
        worker: {
          status: workerStatus,
          instanceId: heartbeat?.instanceId ?? null,
          startedAt: heartbeat?.startedAt ?? null,
          lastSeenAt: heartbeat?.lastSeenAt ?? null,
          heartbeatAgeSeconds:
            heartbeatAgeMs === null ? null : Math.max(0, Math.floor(heartbeatAgeMs / 1000)),
        },
        sampledAt: new Date().toISOString(),
      },
      error: null,
    });
  });
}
