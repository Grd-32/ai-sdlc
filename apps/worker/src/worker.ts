import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { getRedisUrl, QUEUE_NAMES } from "./config.js";
import { processJob } from "./processors/index.js";

let worker: Worker | undefined;
let connection: Redis | undefined;

export function startWorker(): Worker {
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
