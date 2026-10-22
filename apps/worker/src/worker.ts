import { randomUUID } from "node:crypto";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { getRedisUrl, getRetentionPolicy, QUEUE_NAMES } from "./config.js";
import { processJob } from "./processors/index.js";
import { scheduleRetentionCleanup } from "./retention-scheduler.js";
import { closeWorkerQueue } from "./queue.js";

let worker: Worker | undefined;
let connection: Redis | undefined;
let heartbeatTimer: NodeJS.Timeout | undefined;
let lastHeartbeatValue: string | undefined;
const workerInstanceId = randomUUID();
const operationsKeyPrefix = process.env["BULLMQ_PREFIX"]
  ? `${process.env["BULLMQ_PREFIX"]}:`
  : "";
const heartbeatKey = `${operationsKeyPrefix}nomalog:worker:heartbeat`;
const stalledCountKey = `${operationsKeyPrefix}nomalog:worker:stalled-count`;
const stalledLastSeenKey = `${operationsKeyPrefix}nomalog:worker:stalled-last-seen`;
const heartbeatIntervalMs = 10_000;
const heartbeatTtlSeconds = 30;

export async function startWorker(): Promise<Worker> {
  const prefixOptions = process.env["BULLMQ_PREFIX"]
    ? { prefix: process.env["BULLMQ_PREFIX"] }
    : {};
  const schedulerConnection = new Redis(getRedisUrl(), {
    maxRetriesPerRequest: null,
  });
  const schedulerQueue = new Queue(QUEUE_NAMES.GITHUB, {
    connection: schedulerConnection,
    ...prefixOptions,
  });

  try {
    await scheduleRetentionCleanup(schedulerQueue, getRetentionPolicy());
  } finally {
    await schedulerQueue.close();
    await schedulerConnection.quit();
  }

  connection = new Redis(getRedisUrl(), {
    maxRetriesPerRequest: null,
  });
  await connection.set(stalledCountKey, "0");
  await connection.del(stalledLastSeenKey);

  worker = new Worker(QUEUE_NAMES.GITHUB, processJob, {
    connection,
    concurrency: 5,
    ...prefixOptions,
  });

  worker.on("completed", (job) => {
    console.log(`Job completed: ${job.name} (${job.id})`);
  });

  worker.on("failed", (job, err) => {
    console.error(`Job failed: ${job?.name} (${job?.id})`, err.message);
  });

  worker.on("error", (err) => {
    console.error("Worker error:", err.message);
  });

  worker.on("stalled", (jobId) => {
    const redis = connection;
    if (!redis) return;
    void redis
      .multi()
      .incr(stalledCountKey)
      .set(stalledLastSeenKey, new Date().toISOString())
      .exec()
      .catch((error: unknown) => {
        console.error("[worker] failed to record stalled job event", {
          jobId,
          errorType: error instanceof Error ? error.name : "unknown",
        });
      });
  });

  await writeHeartbeat();
  heartbeatTimer = setInterval(() => {
    void writeHeartbeat().catch((error: unknown) => {
      console.error("[worker] heartbeat update failed", {
        errorType: error instanceof Error ? error.name : "unknown",
      });
    });
  }, heartbeatIntervalMs);
  heartbeatTimer.unref();

  console.log(`Worker listening on queue: ${QUEUE_NAMES.GITHUB}`);
  return worker;
}

async function writeHeartbeat(): Promise<void> {
  if (!connection) throw new Error("Worker Redis connection is not available.");
  const now = new Date().toISOString();
  lastHeartbeatValue = JSON.stringify({
    instanceId: workerInstanceId,
    startedAt: workerStartedAt,
    lastSeenAt: now,
  });
  await connection.set(heartbeatKey, lastHeartbeatValue, "EX", heartbeatTtlSeconds);
}

const workerStartedAt = new Date().toISOString();

export async function stopWorker(): Promise<void> {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
  }
  if (worker) {
    await worker.close();
    worker = undefined;
  }
  if (connection) {
    try {
      if (lastHeartbeatValue) {
        await connection.eval(
          "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
          1,
          heartbeatKey,
          lastHeartbeatValue,
        );
      }
    } finally {
      await connection.quit();
      connection = undefined;
    }
  }
  await closeWorkerQueue();
}
