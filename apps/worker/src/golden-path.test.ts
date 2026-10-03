// /**
//  * Golden-path integration test (README §27/§90, Phase 15).
//  *
//  * This replicates, in CI, the exact manual verification loop used
//  * throughout Phase 12-14 development: a real pull_request webhook ->
//  * ingestGitHubWebhookDelivery -> a real BullMQ job on a real Redis ->
//  * processJob -> processPullRequestAnalyze -> real risk/policy/evidence/
//  * passport persistence -> a (mocked) Check Run publish.
//  *
//  * Only the two functions that make real GitHub network calls are mocked
//  * (listPullRequestFiles, publishCheckRun) — everything else, including the
//  * queue and the worker, is real. This is deliberately NOT a unit test of
//  * processPullRequestAnalyze in isolation: several of tonight's real bugs
//  * (Repository.githubInstallationId never being set, the BullMQ jobId
//  * dedup swallowing re-analysis, the aIActivity Prisma casing mismatch)
//  * would NOT have been caught by a test that skips straight to calling the
//  * worker function with hand-seeded data — they all lived in the handoff
//  * between ingestion and processing, which is exactly what this test
//  * exercises.
//  */

// import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
// import { Worker as BullWorker, type Job } from "bullmq";
// import { Redis } from "ioredis";

// process.env["DATABASE_URL"] =
//   process.env["DATABASE_URL"] ?? "postgresql://ai_sdlc:ai_sdlc_dev@localhost:5432/ai_sdlc?schema=public";
// process.env["REDIS_URL"] = process.env["REDIS_URL"] ?? "redis://localhost:6379";

// const publishCheckRunMock = vi.fn().mockResolvedValue({ checkRunId: "mock-check-run-1", conclusion: "failure" });
// const listPullRequestFilesMock = vi.fn().mockResolvedValue([
//   { filename: "src/auth/login.ts", status: "modified", additions: 12, deletions: 3, changes: 15 },
// ]);

// vi.mock("@ai-sdlc/github", async (importOriginal) => {
//   const actual = await importOriginal<typeof import("@ai-sdlc/github")>();
//   return {
//     ...actual,
//     listPullRequestFiles: listPullRequestFilesMock,
//     publishCheckRun: publishCheckRunMock,
//   };
// });

// const { prisma } = await import("@ai-sdlc/db");
// const { ingestGitHubWebhookDelivery } = await import("@ai-sdlc/api/webhooks");
// const { processJob } = await import("./processors/index.js");
// const { QUEUE_NAMES, JOB_TYPES } = await import("./config.js");

// const runId = Date.now().toString(36);
// // Purely numeric (unlike runId, which is base36 and can contain letters) —
// // this round-trips through the webhook payload's JSON `installation.id`
// // number field and back into a DB string lookup.
// const GITHUB_INSTALLATION_ID = String(Date.now());
// const REPO_OWNER = "golden-path-test";
// const REPO_NAME = `repo-${runId}`;

// let organization: { id: string };
// let connection: Redis;
// let worker: BullWorker;

// /** Resolves once a job with this name completes — avoids sleeping an arbitrary amount. */
// function waitForJobCompletion(jobName: string, timeoutMs = 15000): Promise<void> {
//   return new Promise((resolve, reject) => {
//     const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${jobName} to complete`)), timeoutMs);
//     const onCompleted = (job: Job): void => {
//       if (job.name === jobName) {
//         clearTimeout(timer);
//         worker.off("completed", onCompleted);
//         resolve();
//       }
//     };
//     worker.on("completed", onCompleted);
//   });
// }

// function buildPullRequestPayload(overrides: { number: number; externalId: number; headSha: string }) {
//   return {
//     action: "opened",
//     installation: { id: Number(GITHUB_INSTALLATION_ID) },
//     repository: {
//       id: 1000 + overrides.number,
//       name: REPO_NAME,
//       full_name: `${REPO_OWNER}/${REPO_NAME}`,
//       owner: { login: REPO_OWNER },
//       default_branch: "main",
//       private: false,
//     },
//     pull_request: {
//       id: overrides.externalId,
//       number: overrides.number,
//       title: "Update login flow",
//       state: "open",
//       user: { login: "test-author" },
//       head: { ref: "feature/login", sha: overrides.headSha },
//       base: { ref: "main" },
//       created_at: new Date().toISOString(),
//       updated_at: new Date().toISOString(),
//       merged_at: null,
//       additions: 12,
//       deletions: 3,
//       changed_files: 1,
//     },
//   };
// }

// beforeAll(async () => {
//   organization = await prisma.organization.create({
//     data: { name: `Golden Path Test ${runId}`, slug: `golden-path-test-${runId}` },
//   });

//   await prisma.gitHubInstallation.create({
//     data: {
//       organizationId: organization.id,
//       githubInstallationId: GITHUB_INSTALLATION_ID,
//       accountLogin: REPO_OWNER,
//       accountType: "Organization",
//       active: true,
//     },
//   });

//   connection = new Redis(process.env["REDIS_URL"]!, { maxRetriesPerRequest: null });
//   worker = new BullWorker(QUEUE_NAMES.GITHUB, processJob, { connection, concurrency: 1 });
//   await worker.waitUntilReady();
// }, 20000);

// afterAll(async () => {
//   await worker.close();
//   await connection.quit();
//   // Cascades to every child row (Repository, PullRequest, CodeChange,
//   // RiskAssessment, PolicyDecision, ChangePassport, Evidence, AIActivity,
//   // Commit, Policy, PolicyRule) via onDelete: Cascade on Organization.
//   await prisma.organization.delete({ where: { id: organization.id } }).catch(() => undefined);
// }, 20000);

// describe("Golden path: webhook -> analysis -> policy -> passport -> Check Run", () => {
//   it(
//     "processes a PR end-to-end and produces a coherent, explainable decision",
//     async () => {
//       const headSha = `sha-${runId}-1`;
//       const payload = buildPullRequestPayload({ number: 1, externalId: 5000, headSha });

//       const completion = waitForJobCompletion(JOB_TYPES.PR_ANALYZE);

//       await ingestGitHubWebhookDelivery(JSON.stringify(payload), {
//         "x-github-event": "pull_request",
//         "x-github-delivery": `delivery-${runId}-1`,
//       });

//       await completion;

//       const pullRequest = await prisma.pullRequest.findFirst({
//         where: { organizationId: organization.id, number: 1 },
//       });
//       expect(pullRequest).not.toBeNull();
//       // The idempotency marker whose staleness caused real confusion
//       // multiple times tonight — confirm it actually gets set correctly.
//       expect(pullRequest?.lastAnalyzedSha).toBe(headSha);
//       expect(pullRequest?.githubCheckRunId).toBe("mock-check-run-1");

//       // Force deterministic AI provenance rather than depending on
//       // @ai-sdlc/provenance's title/body heuristics, which this test isn't
//       // trying to exercise — it exercises what happens once provenance
//       // has an opinion, whatever that opinion is.
//       await prisma.aIActivity.updateMany({
//         where: { pullRequestId: pullRequest!.id },
//         data: { involvement: "YES", confidence: 0.95, agent: "claude-code" },
//       });

//       const codeChange = await prisma.codeChange.findFirst({ where: { pullRequestId: pullRequest!.id } });
//       expect(codeChange?.sensitiveAreas).toContain("AUTHENTICATION");

//       const riskAssessment = await prisma.riskAssessment.findFirst({
//         where: { pullRequestId: pullRequest!.id },
//         orderBy: { createdAt: "desc" },
//       });
//       expect(riskAssessment).not.toBeNull();

//       const passport = await prisma.changePassport.findFirst({ where: { pullRequestId: pullRequest!.id } });
//       expect(passport).not.toBeNull();

//       expect(listPullRequestFilesMock).toHaveBeenCalled();
//       expect(publishCheckRunMock).toHaveBeenCalledWith(
//         expect.objectContaining({ headSha }),
//       );
//     },
//     20000,
//   );

//   it(
//     "an org-defined DB policy rule genuinely changes the decision to BLOCK",
//     async () => {
//       const policy = await prisma.policy.create({
//         data: { organizationId: organization.id, name: "Auth Lockdown Test", enabled: true },
//       });
//       const rule = await prisma.policyRule.create({
//         data: {
//           organizationId: organization.id,
//           policyId: policy.id,
//           name: "Block all auth changes",
//           sensitiveAreas: ["AUTHENTICATION"],
//           action: "BLOCK",
//           reason: "Golden path test rule",
//         },
//       });

//       const headSha = `sha-${runId}-2`;
//       const payload = buildPullRequestPayload({ number: 2, externalId: 5001, headSha });

//       const completion = waitForJobCompletion(JOB_TYPES.PR_ANALYZE);
//       await ingestGitHubWebhookDelivery(JSON.stringify(payload), {
//         "x-github-event": "pull_request",
//         "x-github-delivery": `delivery-${runId}-2`,
//       });
//       await completion;

//       const pullRequest = await prisma.pullRequest.findFirst({
//         where: { organizationId: organization.id, number: 2 },
//       });
//       const policyDecision = await prisma.policyDecision.findFirst({
//         where: { pullRequestId: pullRequest!.id },
//         orderBy: { createdAt: "desc" },
//       });

//       expect(policyDecision?.action).toBe("BLOCK");
//       expect(policyDecision?.matchedRuleIds).toContain(rule.id);
//       expect(publishCheckRunMock).toHaveBeenCalledWith(
//         expect.objectContaining({
//           headSha,
//           summaryInput: expect.objectContaining({ policyAction: "BLOCK" }),
//         }),
//       );
//     },
//     20000,
//   );

//   it(
//     "a genuine new push to the same PR is still analyzed (BullMQ dedup regression guard)",
//     async () => {
//       // Regression test for tonight's real bug: a fixed custom BullMQ jobId
//       // caused every enqueue after the first completed job for a given PR
//       // to be silently swallowed. enqueuePullRequestAnalysis no longer
//       // passes a custom jobId — this proves a second push to the same PR
//       // still gets a job that actually runs, not just that the first one did.
//       const firstSha = `sha-${runId}-3a`;
//       const secondSha = `sha-${runId}-3b`;

//       const firstPayload = buildPullRequestPayload({ number: 3, externalId: 5002, headSha: firstSha });
//       const firstCompletion = waitForJobCompletion(JOB_TYPES.PR_ANALYZE);
//       await ingestGitHubWebhookDelivery(JSON.stringify(firstPayload), {
//         "x-github-event": "pull_request",
//         "x-github-delivery": `delivery-${runId}-3a`,
//       });
//       await firstCompletion;

//       const afterFirst = await prisma.pullRequest.findFirst({
//         where: { organizationId: organization.id, number: 3 },
//       });
//       expect(afterFirst?.lastAnalyzedSha).toBe(firstSha);

//       const secondPayload = {
//         ...firstPayload,
//         action: "synchronize",
//         pull_request: {
//           ...firstPayload.pull_request,
//           head: { ref: "feature/login", sha: secondSha },
//         },
//       };

//       const secondCompletion = waitForJobCompletion(JOB_TYPES.PR_ANALYZE);
//       await ingestGitHubWebhookDelivery(JSON.stringify(secondPayload), {
//         "x-github-event": "pull_request",
//         "x-github-delivery": `delivery-${runId}-3b`,
//       });
//       await secondCompletion;

//       const afterSecond = await prisma.pullRequest.findFirst({
//         where: { organizationId: organization.id, number: 3 },
//       });
//       expect(afterSecond?.lastAnalyzedSha).toBe(secondSha);
//     },
//     30000,
//   );
// });

/**
 * Golden-path integration test (README §27/§90, Phase 15).
 *
 * This replicates, in CI, the exact manual verification loop used
 * throughout Phase 12-14 development: a real pull_request webhook ->
 * ingestGitHubWebhookDelivery -> a real BullMQ job on a real Redis ->
 * processJob -> processPullRequestAnalyze -> real risk/policy/evidence/
 * passport persistence -> a (mocked) Check Run publish.
 *
 * Only the two functions that make real GitHub network calls are mocked
 * (listPullRequestFiles, publishCheckRun) — everything else, including the
 * queue and the worker, is real.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Worker as BullWorker, type Job } from "bullmq";
import { Redis } from "ioredis";

process.env["DATABASE_URL"] =
  process.env["DATABASE_URL"] ?? "postgresql://ai_sdlc:ai_sdlc_dev@localhost:5432/ai_sdlc?schema=public";
process.env["REDIS_URL"] = process.env["REDIS_URL"] ?? "redis://localhost:6379";

const publishCheckRunMock = vi.fn().mockResolvedValue({ checkRunId: "mock-check-run-1", conclusion: "failure" });
const listPullRequestFilesMock = vi.fn().mockResolvedValue([
  { filename: "src/auth/login.ts", status: "modified", additions: 12, deletions: 3, changes: 15 },
]);

vi.mock("@ai-sdlc/github", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ai-sdlc/github")>();
  return {
    ...actual,
    listPullRequestFiles: listPullRequestFilesMock,
    publishCheckRun: publishCheckRunMock,
  };
});

const { prisma } = await import("@ai-sdlc/db");
const { ingestGitHubWebhookDelivery } = await import("@ai-sdlc/api/webhooks");
const { processJob } = await import("./processors/index.js");
const { QUEUE_NAMES, JOB_TYPES } = await import("./config.js");

const runId = Date.now().toString(36);
const GITHUB_INSTALLATION_ID = String(Date.now());
const REPO_OWNER = "golden-path-test";
const REPO_NAME = `repo-${runId}`;

let organization: { id: string };
let connection: Redis;
let worker: BullWorker;

/**
 * Tracks every job outcome (completed OR failed) rather than only
 * listening for "completed" — a job that's actually throwing (and
 * retrying, per the queue's attempts:3/backoff config) would otherwise
 * produce a bare, uninformative timeout instead of the real error.
 */
interface JobOutcome {
  name: string;
  ok: boolean;
  error?: string;
}
const jobOutcomes: JobOutcome[] = [];

function waitForJobOutcome(jobName: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = (): void => {
      const index = jobOutcomes.findIndex((o) => o.name === jobName);
      if (index !== -1) {
        const outcome = jobOutcomes.splice(index, 1)[0]!;
        if (outcome.ok) {
          resolve();
        } else {
          reject(new Error(`Job "${jobName}" failed: ${outcome.error}`));
        }
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Timed out waiting for "${jobName}" (no completed or failed event seen)`));
        return;
      }
      setTimeout(check, 100);
    };
    check();
  });
}

function buildPullRequestPayload(overrides: { number: number; externalId: number; headSha: string }) {
  return {
    action: "opened",
    installation: { id: Number(GITHUB_INSTALLATION_ID) },
    repository: {
      id: 1000 + overrides.number,
      name: REPO_NAME,
      full_name: `${REPO_OWNER}/${REPO_NAME}`,
      owner: { login: REPO_OWNER },
      default_branch: "main",
      private: false,
    },
    pull_request: {
      id: overrides.externalId,
      number: overrides.number,
      title: "Update login flow",
      state: "open",
      user: { login: "test-author" },
      head: { ref: "feature/login", sha: overrides.headSha },
      base: { ref: "main" },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      merged_at: null,
      additions: 12,
      deletions: 3,
      changed_files: 1,
    },
  };
}

beforeAll(async () => {
  organization = await prisma.organization.create({
    data: { name: `Golden Path Test ${runId}`, slug: `golden-path-test-${runId}` },
  });

  await prisma.gitHubInstallation.create({
    data: {
      organizationId: organization.id,
      githubInstallationId: GITHUB_INSTALLATION_ID,
      accountLogin: REPO_OWNER,
      accountType: "Organization",
      active: true,
    },
  });

  connection = new Redis(process.env["REDIS_URL"]!, { maxRetriesPerRequest: null });
  worker = new BullWorker(QUEUE_NAMES.GITHUB, processJob, { connection, concurrency: 1 });

  worker.on("completed", (job: Job) => {
    jobOutcomes.push({ name: job.name, ok: true });
  });
  worker.on("failed", (job: Job | undefined, error: Error) => {
    jobOutcomes.push({ name: job?.name ?? "unknown", ok: false, error: error.message });
    // eslint-disable-next-line no-console
    console.error(`[golden-path test] job "${job?.name}" failed:`, error);
  });

  await worker.waitUntilReady();
}, 20000);

afterAll(async () => {
  await worker.close();
  await connection.quit();
  await prisma.organization.delete({ where: { id: organization.id } }).catch(() => undefined);
}, 20000);

describe("Golden path: webhook -> analysis -> policy -> passport -> Check Run", () => {
  it(
    "processes a PR end-to-end and produces a coherent, explainable decision",
    async () => {
      const headSha = `sha-${runId}-1`;
      const payload = buildPullRequestPayload({ number: 1, externalId: 5000, headSha });

      const completion = waitForJobOutcome(JOB_TYPES.PR_ANALYZE);

      await ingestGitHubWebhookDelivery(JSON.stringify(payload), {
        "x-github-event": "pull_request",
        "x-github-delivery": `delivery-${runId}-1`,
      });

      await completion;

      const pullRequest = await prisma.pullRequest.findFirst({
        where: { organizationId: organization.id, number: 1 },
      });
      expect(pullRequest).not.toBeNull();
      expect(pullRequest?.lastAnalyzedSha).toBe(headSha);
      expect(pullRequest?.githubCheckRunId).toBe("mock-check-run-1");

      await prisma.aIActivity.updateMany({
        where: { pullRequestId: pullRequest!.id },
        data: { involvement: "YES", confidence: 0.95, agent: "claude-code" },
      });

      const codeChange = await prisma.codeChange.findFirst({ where: { pullRequestId: pullRequest!.id } });
      expect(codeChange?.sensitiveAreas).toContain("AUTHENTICATION");

      const riskAssessment = await prisma.riskAssessment.findFirst({
        where: { pullRequestId: pullRequest!.id },
        orderBy: { createdAt: "desc" },
      });
      expect(riskAssessment).not.toBeNull();

      const passport = await prisma.changePassport.findFirst({ where: { pullRequestId: pullRequest!.id } });
      expect(passport).not.toBeNull();

      expect(listPullRequestFilesMock).toHaveBeenCalled();
      expect(publishCheckRunMock).toHaveBeenCalledWith(expect.objectContaining({ headSha }));
    },
    20000,
  );

  it(
    "an org-defined DB policy rule genuinely changes the decision to BLOCK",
    async () => {
      const policy = await prisma.policy.create({
        data: { organizationId: organization.id, name: "Auth Lockdown Test", enabled: true },
      });
      const rule = await prisma.policyRule.create({
        data: {
          organizationId: organization.id,
          policyId: policy.id,
          name: "Block all auth changes",
          sensitiveAreas: ["AUTHENTICATION"],
          action: "BLOCK",
          reason: "Golden path test rule",
        },
      });

      const headSha = `sha-${runId}-2`;
      const payload = buildPullRequestPayload({ number: 2, externalId: 5001, headSha });

      const completion = waitForJobOutcome(JOB_TYPES.PR_ANALYZE);
      await ingestGitHubWebhookDelivery(JSON.stringify(payload), {
        "x-github-event": "pull_request",
        "x-github-delivery": `delivery-${runId}-2`,
      });
      await completion;

      const pullRequest = await prisma.pullRequest.findFirst({
        where: { organizationId: organization.id, number: 2 },
      });
      const policyDecision = await prisma.policyDecision.findFirst({
        where: { pullRequestId: pullRequest!.id },
        orderBy: { createdAt: "desc" },
      });

      expect(policyDecision?.action).toBe("BLOCK");
      expect(policyDecision?.matchedRuleIds).toContain(rule.id);
      expect(publishCheckRunMock).toHaveBeenCalledWith(
        expect.objectContaining({ headSha, summaryInput: expect.objectContaining({ policyAction: "BLOCK" }) }),
      );
    },
    20000,
  );

  it(
    "a genuine new push to the same PR is still analyzed (BullMQ dedup regression guard)",
    async () => {
      const firstSha = `sha-${runId}-3a`;
      const secondSha = `sha-${runId}-3b`;

      const firstPayload = buildPullRequestPayload({ number: 3, externalId: 5002, headSha: firstSha });
      const firstCompletion = waitForJobOutcome(JOB_TYPES.PR_ANALYZE);
      await ingestGitHubWebhookDelivery(JSON.stringify(firstPayload), {
        "x-github-event": "pull_request",
        "x-github-delivery": `delivery-${runId}-3a`,
      });
      await firstCompletion;

      const afterFirst = await prisma.pullRequest.findFirst({
        where: { organizationId: organization.id, number: 3 },
      });
      expect(afterFirst?.lastAnalyzedSha).toBe(firstSha);

      const secondPayload = {
        ...firstPayload,
        action: "synchronize",
        pull_request: { ...firstPayload.pull_request, head: { ref: "feature/login", sha: secondSha } },
      };

      const secondCompletion = waitForJobOutcome(JOB_TYPES.PR_ANALYZE);
      await ingestGitHubWebhookDelivery(JSON.stringify(secondPayload), {
        "x-github-event": "pull_request",
        "x-github-delivery": `delivery-${runId}-3b`,
      });
      await secondCompletion;

      const afterSecond = await prisma.pullRequest.findFirst({
        where: { organizationId: organization.id, number: 3 },
      });
      expect(afterSecond?.lastAnalyzedSha).toBe(secondSha);
    },
    30000,
  );
});