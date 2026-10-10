/** Shared BullMQ queue names — used by API (producer) and Worker (consumer). */
export const QUEUE_NAMES = {
  GITHUB: "github",
} as const;

export const JOB_TYPES = {
  PR_ANALYZE: "github.pr.analyze",
  REPOSITORY_SYNC: "github.repository.sync",
  COMMIT_SYNC: "github.commit.sync",
  SECURITY_FINDINGS_SYNC: "security.findings.sync",
  PASSPORT_REBUILD: "passport.rebuild",
  HEALTH_CHECK: "system.health.check",
  GITHUB_WEBHOOK_EVENT: "github.webhook.event",
  RETENTION_CLEANUP: "privacy.retention.cleanup",
} as const;

export const RETENTION_SCHEDULER_ID = "privacy-retention-cleanup-daily";
export const RETENTION_SCHEDULER_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const WEBHOOK_STATUS = {
  RECEIVED: "RECEIVED",
  PROCESSING: "PROCESSING",
  RETRYING: "RETRYING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  DLQ: "DLQ",
} as const;

export const WEBHOOK_RETRY_OPTIONS = {
  attempts: 5,
  backoff: { type: "exponential" as const, delay: 2000 },
  timeout: 30000,
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
} as const;

export type JobType = (typeof JOB_TYPES)[keyof typeof JOB_TYPES];

export type RetentionPolicy = {
  sessionMaxAgeDays: number;
  webhookMaxAgeDays: number;
};

function readPositiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function getRetentionPolicy(
  env: Record<string, string | undefined> = process.env,
): RetentionPolicy {
  return {
    sessionMaxAgeDays: readPositiveInteger(
      env["SESSION_RETENTION_DAYS"],
      30,
      "SESSION_RETENTION_DAYS",
    ),
    webhookMaxAgeDays: readPositiveInteger(
      env["WEBHOOK_RETENTION_DAYS"],
      90,
      "WEBHOOK_RETENTION_DAYS",
    ),
  };
}

export function getRedisUrl(): string {
  const url = process.env["REDIS_URL"];
  if (!url) {
    throw new Error("REDIS_URL environment variable is required");
  }
  return url;
}
