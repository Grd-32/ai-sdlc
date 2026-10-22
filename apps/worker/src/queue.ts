import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { JOB_TYPES, QUEUE_NAMES, getRedisUrl } from "./config.js";

let connection: Redis | undefined;
let queue: Queue | undefined;

function getQueue(): Queue {
  connection ??= new Redis(getRedisUrl(), { maxRetriesPerRequest: null });
  queue ??= new Queue(QUEUE_NAMES.GITHUB, {
    connection,
    ...(process.env["BULLMQ_PREFIX"] ? { prefix: process.env["BULLMQ_PREFIX"] } : {}),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    },
  });
  return queue;
}

export async function enqueueNotificationDelivery(notificationId: string): Promise<void> {
  await getQueue().add(
    JOB_TYPES.NOTIFICATION_DELIVER,
    { notificationId },
    { jobId: `notification-${notificationId}` },
  );
}

export async function closeWorkerQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = undefined;
  }
  if (connection) {
    await connection.quit();
    connection = undefined;
  }
}
