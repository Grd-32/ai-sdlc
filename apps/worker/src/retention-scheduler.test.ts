import { describe, expect, it, vi } from "vitest";
import type { Queue } from "bullmq";
import {
  FINDING_SLA_ESCALATION_SCHEDULER_ID,
  JOB_TYPES,
  RETENTION_SCHEDULER_ID,
  RETENTION_SCHEDULER_INTERVAL_MS,
  RISK_ACCEPTANCE_EXPIRY_SCHEDULER_ID,
} from "./config.js";
import { scheduleRetentionCleanup } from "./retention-scheduler.js";

describe("scheduleRetentionCleanup", () => {
  it("upserts all daily maintenance jobs", async () => {
    const upsertJobScheduler = vi.fn().mockResolvedValue(undefined);
    const queue = { upsertJobScheduler } as unknown as Queue;
    const policy = { sessionMaxAgeDays: 14, webhookMaxAgeDays: 60 };

    await scheduleRetentionCleanup(queue, policy);

    expect(upsertJobScheduler).toHaveBeenCalledWith(
      RETENTION_SCHEDULER_ID,
      { every: RETENTION_SCHEDULER_INTERVAL_MS },
      expect.objectContaining({ name: JOB_TYPES.RETENTION_CLEANUP, data: policy }),
    );
    expect(upsertJobScheduler).toHaveBeenCalledWith(
      RISK_ACCEPTANCE_EXPIRY_SCHEDULER_ID,
      { every: RETENTION_SCHEDULER_INTERVAL_MS },
      expect.objectContaining({ name: JOB_TYPES.RISK_ACCEPTANCE_EXPIRY, data: {} }),
    );
    expect(upsertJobScheduler).toHaveBeenCalledWith(
      FINDING_SLA_ESCALATION_SCHEDULER_ID,
      { every: RETENTION_SCHEDULER_INTERVAL_MS },
      expect.objectContaining({ name: JOB_TYPES.FINDING_SLA_ESCALATION, data: {} }),
    );
    expect(upsertJobScheduler).toHaveBeenCalledTimes(3);
  });
});
