import { Queue } from "bullmq";
import { createHash } from "node:crypto";
import { Redis } from "ioredis";
import { getRedisUrl, JOB_TYPES, QUEUE_NAMES } from "./config.js";

let connection: Redis | undefined;
let githubQueue: Queue | undefined;

export function getRedisConnection(): Redis {
  if (!connection) {
    connection = new Redis(getRedisUrl(), {
      maxRetriesPerRequest: null,
    });
  }
  return connection;
}

export function getGithubQueue(): Queue {
  if (!githubQueue) {
    githubQueue = new Queue(QUEUE_NAMES.GITHUB, {
      connection: getRedisConnection(),
      ...(process.env["BULLMQ_PREFIX"] ? { prefix: process.env["BULLMQ_PREFIX"] } : {}),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    });
  }
  return githubQueue;
}

export async function enqueueHealthCheck(): Promise<string> {
  const queue = getGithubQueue();
  const job = await queue.add(JOB_TYPES.HEALTH_CHECK, {
    enqueuedAt: new Date().toISOString(),
  });
  return job.id ?? "unknown";
}

export async function enqueueGitHubWebhookEvent(payload: {
  eventType: string;
  deliveryId: string;
  payloadHash: string;
  payload: unknown;
  installationId?: string;
  repositoryId?: string;
  organizationId?: string;
}): Promise<string> {
  const queue = getGithubQueue();
  const jobId = getGitHubWebhookEventJobId(payload.eventType, payload.deliveryId);
  const job = await queue.add(
    JOB_TYPES.GITHUB_WEBHOOK_EVENT,
    {
      ...payload,
      enqueuedAt: new Date().toISOString(),
    },
    { jobId },
  );
  return job.id ?? jobId;
}

export async function enqueueSourceControlWebhookEvent(payload: {
  provider: string;
  eventType: string;
  deliveryId: string;
  payloadHash: string;
  organizationId?: string;
  repositoryId?: string;
}): Promise<string> {
  const queue = getGithubQueue();
  const jobId = createHash("sha256")
    .update(`${payload.provider}:${payload.eventType}:${payload.deliveryId}`)
    .digest("hex");
  const job = await queue.add(
    JOB_TYPES.SOURCE_CONTROL_WEBHOOK_EVENT,
    { ...payload, enqueuedAt: new Date().toISOString() },
    { jobId },
  );
  return job.id ?? jobId;
}

export function getGitHubWebhookEventJobId(eventType: string, deliveryId: string): string {
  return createHash("sha256").update(`${eventType}:${deliveryId}`).digest("hex");
}

/**
 * Phase 12: enqueue the PR analysis pipeline (risk -> policy -> evidence -> passport -> Check Run).
 *
 * Deliberately no custom jobId. The real idempotency guard lives in
 * apps/worker/src/processors/analyze.ts, which skips re-running the
 * pipeline if pullRequest.lastAnalyzedSha already matches the current
 * head SHA — that's the correct place for it, since every push to a PR
 * produces a genuinely different headSha needing its own analysis and
 * Check Run update. A fixed jobId here previously caused BullMQ to
 * silently swallow every enqueue after the first successful run for a
 * given PR (add() with an already-used jobId returns the existing job
 * instead of queuing a new one), which meant a second real push to an
 * open PR would never get re-analyzed either — a correctness bug, not
 * just a queue-depth optimization as originally assumed.
 */
export async function enqueuePullRequestAnalysis(payload: {
  organizationId: string;
  repositoryId: string;
  pullRequestId: string;
}): Promise<string> {
  const queue = getGithubQueue();
  const job = await queue.add(JOB_TYPES.PR_ANALYZE, {
    ...payload,
    enqueuedAt: new Date().toISOString(),
  });
  return job.id ?? "unknown";
}

export async function enqueueAssessment(payload: {
  assessmentId: string;
  attempt: number;
}): Promise<string> {
  const queue = getGithubQueue();
  const job = await queue.add(
    JOB_TYPES.ASSESSMENT_RUN,
    { ...payload, enqueuedAt: new Date().toISOString() },
    {
      jobId: `assessment-${payload.assessmentId}-${payload.attempt}`,
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
    },
  );
  return job.id ?? `assessment-${payload.assessmentId}-${payload.attempt}`;
}

export async function enqueueNotificationDelivery(
  notificationId: string,
  attemptOffset = 0,
): Promise<string> {
  const jobId =
    attemptOffset === 0
      ? `notification-${notificationId}`
      : `notification-${notificationId}-retry-${attemptOffset}`;
  const job = await getGithubQueue().add(
    JOB_TYPES.NOTIFICATION_DELIVER,
    { notificationId, attemptOffset },
    { jobId },
  );
  return job.id ?? jobId;
}

export async function closeQueueConnections(): Promise<void> {
  if (githubQueue) {
    await githubQueue.close();
    githubQueue = undefined;
  }
  if (connection) {
    await connection.quit();
    connection = undefined;
  }
}
