import { describe, expect, it, vi } from "vitest";
import type { Queue } from "bullmq";
import { JOB_TYPES, RETENTION_SCHEDULER_ID, RETENTION_SCHEDULER_INTERVAL_MS } from "./config.js";
import { scheduleRetentionCleanup } from "./retention-scheduler.js";

describe("scheduleRetentionCleanup", () => {
  it("upserts one daily cleanup job with the configured retention policy", async () => {
    const upsertJobScheduler = vi.fn().mockResolvedValue(undefined);
    const queue = { upsertJobScheduler } as unknown as Queue;
    const policy = { sessionMaxAgeDays: 14, webhookMaxAgeDays: 60 };

    await scheduleRetentionCleanup(queue, policy);

    expect(upsertJobScheduler).toHaveBeenCalledWith(
      RETENTION_SCHEDULER_ID,
      { every: RETENTION_SCHEDULER_INTERVAL_MS },
      expect.objectContaining({ name: JOB_TYPES.RETENTION_CLEANUP, data: policy }),
    );
  });
});