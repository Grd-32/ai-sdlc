// import type { Job } from "bullmq";
// import { checkDatabaseConnection } from "@ai-sdlc/db";
// import { JOB_TYPES } from "../config.js";

// export interface HealthCheckJobData {
//   enqueuedAt: string;
// }

// export interface GitHubWebhookEventJobData {
//   eventType: string;
//   deliveryId: string;
//   payloadHash: string;
//   payload: unknown;
//   installationId?: string;
//   repositoryId?: string;
//   organizationId?: string;
//   enqueuedAt: string;
// }

// export async function processHealthCheck(job: Job<HealthCheckJobData>): Promise<void> {
//   const dbOk = await checkDatabaseConnection();

//   if (!dbOk) {
//     throw new Error("Database connection check failed");
//   }

//   console.log(`[${JOB_TYPES.HEALTH_CHECK}] job=${job.id} db=ok enqueuedAt=${job.data.enqueuedAt}`);
// }

// export function processGitHubWebhookEvent(job: Job<GitHubWebhookEventJobData>): void {
//   const { eventType, deliveryId, payloadHash, organizationId, repositoryId } = job.data;

//   console.log(
//     `[${JOB_TYPES.GITHUB_WEBHOOK_EVENT}] event=${eventType} delivery=${deliveryId} hash=${payloadHash} org=${organizationId ?? "unknown"} repo=${repositoryId ?? "unknown"}`,
//   );
// }

// export async function processJob(job: Job): Promise<void> {
//   switch (job.name) {
//     case JOB_TYPES.HEALTH_CHECK:
//       await processHealthCheck(job as Job<HealthCheckJobData>);
//       break;
//     case JOB_TYPES.GITHUB_WEBHOOK_EVENT:
//       processGitHubWebhookEvent(job as Job<GitHubWebhookEventJobData>);
//       break;
//     default:
//       console.warn(`Unknown job type: ${job.name}`);
//   }
// }
import type { Job } from "bullmq";
import { checkDatabaseConnection, prisma } from "@ai-sdlc/db";
import { JOB_TYPES, WEBHOOK_STATUS } from "../config.js";
import { processPullRequestAnalyze, type PullRequestAnalyzeJobData } from "./analyze.js";
import { processRetentionCleanup, type RetentionCleanupPolicy } from "./retention.js";

export interface HealthCheckJobData {
  enqueuedAt: string;
}

export interface GitHubWebhookEventJobData {
  eventType: string;
  deliveryId: string;
  payloadHash: string;
  payload: unknown;
  installationId?: string;
  repositoryId?: string;
  organizationId?: string;
  enqueuedAt: string;
}

export async function processHealthCheck(job: Job<HealthCheckJobData>): Promise<void> {
  const dbOk = await checkDatabaseConnection();

  if (!dbOk) {
    throw new Error("Database connection check failed");
  }

  console.log(`[${JOB_TYPES.HEALTH_CHECK}] job=${job.id} db=ok enqueuedAt=${job.data.enqueuedAt}`);
}

export async function processGitHubWebhookEvent(
  job: Job<GitHubWebhookEventJobData>,
): Promise<void> {
  const { eventType, deliveryId, payloadHash, organizationId, repositoryId } = job.data;

  try {
    await prisma.gitHubWebhookEvent.updateMany({
      where: { provider: "GITHUB", deliveryId },
      data: { status: WEBHOOK_STATUS.PROCESSING, processedAt: null },
    });

    console.log(
      `[${JOB_TYPES.GITHUB_WEBHOOK_EVENT}] event=${eventType} delivery=${deliveryId} hash=${payloadHash} org=${organizationId ?? "unknown"} repo=${repositoryId ?? "unknown"}`,
    );

    await prisma.gitHubWebhookEvent.updateMany({
      where: { provider: "GITHUB", deliveryId },
      data: { status: WEBHOOK_STATUS.COMPLETED, processedAt: new Date() },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const maxAttempts = job.opts.attempts ?? 1;
    const willRetry = job.attemptsMade + 1 < maxAttempts;
    await prisma.gitHubWebhookEvent.updateMany({
      where: { provider: "GITHUB", deliveryId },
      data: {
        status: willRetry ? WEBHOOK_STATUS.RETRYING : WEBHOOK_STATUS.FAILED,
        processedAt: willRetry ? null : new Date(),
      },
    });
    throw new Error(`Webhook delivery ${deliveryId} failed: ${message}`);
  }
}

export async function processJob(job: Job): Promise<void> {
  switch (job.name) {
    case JOB_TYPES.HEALTH_CHECK:
      await processHealthCheck(job as Job<HealthCheckJobData>);
      break;
    case JOB_TYPES.GITHUB_WEBHOOK_EVENT:
      await processGitHubWebhookEvent(job as Job<GitHubWebhookEventJobData>);
      break;
    case JOB_TYPES.PR_ANALYZE:
      await processPullRequestAnalyze(job as Job<PullRequestAnalyzeJobData>);
      break;
    case JOB_TYPES.RETENTION_CLEANUP:
      await processRetentionCleanup(prisma, job.data as RetentionCleanupPolicy);
      break;
    default:
      console.warn(`Unknown job type: ${job.name}`);
  }
}
