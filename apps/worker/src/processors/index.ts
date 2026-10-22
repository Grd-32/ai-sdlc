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
import { processAssessment, type AssessmentJobData } from "./assessment.js";
import { processRetentionCleanup, type RetentionCleanupPolicy } from "./retention.js";
import { processNotificationDelivery } from "./notifications.js";
import { processFindingSlaEscalation } from "./finding-sla-escalation.js";
import { processRiskAcceptanceExpiry } from "./risk-acceptance-expiry.js";

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

export interface SourceControlWebhookEventJobData {
  eventType: string;
  deliveryId: string;
  payloadHash: string;
  provider: string;
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
  await processSourceControlWebhookEventData(
    { ...job.data, provider: "GITHUB" },
    job.attemptsMade,
    job.opts.attempts,
  );
}

export async function processSourceControlWebhookEvent(
  job: Job<SourceControlWebhookEventJobData>,
): Promise<void> {
  await processSourceControlWebhookEventData(job.data, job.attemptsMade, job.opts.attempts);
}

async function processSourceControlWebhookEventData(
  data: SourceControlWebhookEventJobData,
  attemptsMade: number,
  configuredAttempts: number | undefined,
): Promise<void> {
  const { provider, eventType, deliveryId, payloadHash, organizationId, repositoryId } = data;

  try {
    await prisma.gitHubWebhookEvent.updateMany({
      where: { provider, deliveryId },
      data: { status: WEBHOOK_STATUS.PROCESSING, processedAt: null },
    });

    console.log(
      `[${JOB_TYPES.SOURCE_CONTROL_WEBHOOK_EVENT}] provider=${provider} event=${eventType} delivery=${deliveryId} hash=${payloadHash} org=${organizationId ?? "unknown"} repo=${repositoryId ?? "unknown"}`,
    );

    await prisma.gitHubWebhookEvent.updateMany({
      where: { provider, deliveryId },
      data: { status: WEBHOOK_STATUS.COMPLETED, processedAt: new Date() },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const maxAttempts = configuredAttempts ?? 1;
    const willRetry = attemptsMade + 1 < maxAttempts;
    await prisma.gitHubWebhookEvent.updateMany({
      where: { provider, deliveryId },
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
    case JOB_TYPES.SOURCE_CONTROL_WEBHOOK_EVENT:
      await processSourceControlWebhookEvent(job as Job<SourceControlWebhookEventJobData>);
      break;
    case JOB_TYPES.PR_ANALYZE:
      await processPullRequestAnalyze(job as Job<PullRequestAnalyzeJobData>);
      break;
    case JOB_TYPES.ASSESSMENT_RUN:
      await processAssessment(job as Job<AssessmentJobData>);
      break;
    case JOB_TYPES.RETENTION_CLEANUP:
      await processRetentionCleanup(prisma, job.data as RetentionCleanupPolicy);
      break;
    case JOB_TYPES.NOTIFICATION_DELIVER:
      await processNotificationDelivery(job as Job<{ notificationId: string }>);
      break;
    case JOB_TYPES.RISK_ACCEPTANCE_EXPIRY:
      await processRiskAcceptanceExpiry();
      break;
    case JOB_TYPES.FINDING_SLA_ESCALATION:
      await processFindingSlaEscalation();
      break;
    default:
      console.warn(`Unknown job type: ${job.name}`);
  }
}
