import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { getRedisUrl, getRetentionPolicy, QUEUE_NAMES } from "./config.js";
import { processJob } from "./processors/index.js";
import { scheduleRetentionCleanup } from "./retention-scheduler.js";

let worker: Worker | undefined;
let connection: Redis | undefined;

export async function startWorker(): Promise<Worker> {
  const schedulerConnection = new Redis(getRedisUrl(), {
    maxRetriesPerRequest: null,
  });
  const schedulerQueue = new Queue(QUEUE_NAMES.GITHUB, { connection: schedulerConnection });

  try {
    await scheduleRetentionCleanup(schedulerQueue, getRetentionPolicy());
  } finally {
    await schedulerQueue.close();
    await schedulerConnection.quit();
  }

  connection = new Redis(getRedisUrl(), {
    maxRetriesPerRequest: null,
  });

  worker = new Worker(QUEUE_NAMES.GITHUB, processJob, {
    connection,
    concurrency: 5,
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

  console.log(`Worker listening on queue: ${QUEUE_NAMES.GITHUB}`);
  return worker;
}

export async function stopWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = undefined;
  }
  if (connection) {
    await connection.quit();
    connection = undefined;
  }
}
