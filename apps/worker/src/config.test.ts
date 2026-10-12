import { describe, it, expect } from "vitest";
import { JOB_TYPES, QUEUE_NAMES, WEBHOOK_STATUS, WEBHOOK_RETRY_OPTIONS, getRetentionPolicy } from "./config.js";

describe("Worker config", () => {
  it("defines health check job type", () => {
    expect(JOB_TYPES.HEALTH_CHECK).toBe("system.health.check");
  });

  it("uses github queue name", () => {
    expect(QUEUE_NAMES.GITHUB).toBe("github");
  });

  it("defines a durable webhook lifecycle and retry policy", () => {
    expect(WEBHOOK_STATUS.RECEIVED).toBe("RECEIVED");
    expect(WEBHOOK_STATUS.PROCESSING).toBe("PROCESSING");
    expect(WEBHOOK_STATUS.FAILED).toBe("FAILED");
    expect(WEBHOOK_RETRY_OPTIONS.attempts).toBeGreaterThanOrEqual(3);
    expect(WEBHOOK_RETRY_OPTIONS.backoff.type).toBe("exponential");
  });

  it("uses safe defaults and validates configured retention ages", () => {
    expect(getRetentionPolicy({})).toEqual({ sessionMaxAgeDays: 30, webhookMaxAgeDays: 90 });
    expect(getRetentionPolicy({ SESSION_RETENTION_DAYS: "14", WEBHOOK_RETENTION_DAYS: "60" })).toEqual({
      sessionMaxAgeDays: 14,
      webhookMaxAgeDays: 60,
    });
    expect(() => getRetentionPolicy({ SESSION_RETENTION_DAYS: "0" })).toThrow("positive integer");
  });
});
