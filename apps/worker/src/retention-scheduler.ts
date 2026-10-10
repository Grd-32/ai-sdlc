import type { Queue } from "bullmq";
import {
  JOB_TYPES,
  RETENTION_SCHEDULER_ID,
  RETENTION_SCHEDULER_INTERVAL_MS,
  type RetentionPolicy,
} from "./config.js";

export async function scheduleRetentionCleanup(queue: Queue, policy: RetentionPolicy): Promise<void> {
  await queue.upsertJobScheduler(
    RETENTION_SCHEDULER_ID,
    { every: RETENTION_SCHEDULER_INTERVAL_MS },
    {
      name: JOB_TYPES.RETENTION_CLEANUP,
      data: policy,
      opts: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 1000 },
      },
    },
  );
}