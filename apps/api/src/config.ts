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
} as const;

export type JobType = (typeof JOB_TYPES)[keyof typeof JOB_TYPES];

export function getRedisUrl(): string {
  const url = process.env["REDIS_URL"];
  if (!url) {
    throw new Error("REDIS_URL environment variable is required");
  }
  return url;
}

export function getPort(): number {
  return Number(process.env["API_PORT"] ?? 3001);
}
