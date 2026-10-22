import type { Queue } from "bullmq";
import {
  JOB_TYPES,
  FINDING_SLA_ESCALATION_SCHEDULER_ID,
  RETENTION_SCHEDULER_ID,
  RETENTION_SCHEDULER_INTERVAL_MS,
  RISK_ACCEPTANCE_EXPIRY_SCHEDULER_ID,
  type RetentionPolicy,
} from "./config.js";

export async function scheduleRetentionCleanup(
  queue: Queue,
  policy: RetentionPolicy,
): Promise<void> {
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
  await queue.upsertJobScheduler(
    RISK_ACCEPTANCE_EXPIRY_SCHEDULER_ID,
    { every: RETENTION_SCHEDULER_INTERVAL_MS },
    {
      name: JOB_TYPES.RISK_ACCEPTANCE_EXPIRY,
      data: {},
      opts: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 1000 },
      },
    },
  );
  await queue.upsertJobScheduler(
    FINDING_SLA_ESCALATION_SCHEDULER_ID,
    { every: RETENTION_SCHEDULER_INTERVAL_MS },
    {
      name: JOB_TYPES.FINDING_SLA_ESCALATION,
      data: {},
      opts: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 1000 },
      },
    },
  );
}
