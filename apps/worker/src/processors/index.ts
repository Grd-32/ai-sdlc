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
import { checkDatabaseConnection } from "@ai-sdlc/db";
import { JOB_TYPES } from "../config.js";
import { processPullRequestAnalyze, type PullRequestAnalyzeJobData } from "./analyze.js";

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

export function processGitHubWebhookEvent(job: Job<GitHubWebhookEventJobData>): void {
  const { eventType, deliveryId, payloadHash, organizationId, repositoryId } = job.data;

  console.log(
    `[${JOB_TYPES.GITHUB_WEBHOOK_EVENT}] event=${eventType} delivery=${deliveryId} hash=${payloadHash} org=${organizationId ?? "unknown"} repo=${repositoryId ?? "unknown"}`,
  );
}

export async function processJob(job: Job): Promise<void> {
  switch (job.name) {
    case JOB_TYPES.HEALTH_CHECK:
      await processHealthCheck(job as Job<HealthCheckJobData>);
      break;
    case JOB_TYPES.GITHUB_WEBHOOK_EVENT:
      processGitHubWebhookEvent(job as Job<GitHubWebhookEventJobData>);
      break;
    case JOB_TYPES.PR_ANALYZE:
      await processPullRequestAnalyze(job as Job<PullRequestAnalyzeJobData>);
      break;
    default:
      console.warn(`Unknown job type: ${job.name}`);
  }
}