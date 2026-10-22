// /**
//  * PR analysis pipeline (github.pr.analyze).
//  *
//  * This is the golden-path worker job described in README §38/§90: given a
//  * persisted PR, it fetches changed files, classifies sensitive areas,
//  * collects security evidence, computes risk (risk-v2), evaluates policy,
//  * derives the Change Passport, and publishes a GitHub Check Run.
//  *
//  * Idempotent: skips re-analysis if `pullRequest.lastAnalyzedSha` already
//  * matches the current head SHA (README §66). Per-run outputs (CodeChange,
//  * SecurityFinding, Evidence) are replaced rather than appended so retries
//  * never accumulate duplicate rows.
//  */

// import type { Job } from "bullmq";
// import { prisma, recordAuditEvent } from "@ai-sdlc/db";
// import {
//   classifyFilePaths,
//   evaluateRisk,
//   type RiskAssessmentInput,
//   type SensitiveArea,
// } from "@ai-sdlc/risk";
// import { evaluatePolicy, type PolicyEvaluationInput } from "@ai-sdlc/policy";
// import {
//   createCodeQLProvider,
//   createSemgrepProvider,
//   createSnykProvider,
//   createSonarProvider,
//   deriveChangePassport,
//   normalizeSecurityFinding,
//   summarizeEvidence,
//   type SecurityEvidence,
//   type SecurityFinding as NormalizedSecurityFinding,
// } from "@ai-sdlc/security";
// import { listPullRequestFiles, publishCheckRun } from "@ai-sdlc/github";
// import { JOB_TYPES } from "../config.js";

// export interface PullRequestAnalyzeJobData {
//   organizationId: string;
//   repositoryId: string;
//   pullRequestId: string;
//   enqueuedAt: string;
// }

// const DASHBOARD_BASE_URL = process.env["DASHBOARD_BASE_URL"] ?? "";

// function buildPassportUrl(passportId: string): string | undefined {
//   if (!DASHBOARD_BASE_URL) {
//     return undefined;
//   }
//   return `${DASHBOARD_BASE_URL.replace(/\/$/, "")}/passports/${passportId}`;
// }

// export async function processPullRequestAnalyze(job: Job<PullRequestAnalyzeJobData>): Promise<void> {
//   const { organizationId, repositoryId, pullRequestId } = job.data;
//   const logPrefix = `[${JOB_TYPES.PR_ANALYZE}]`;

//   const pullRequest = await prisma.pullRequest.findUnique({ where: { id: pullRequestId } });
//   if (!pullRequest) {
//     console.warn(`${logPrefix} pull request ${pullRequestId} not found, skipping`);
//     return;
//   }

//   const repository = await prisma.repository.findUnique({ where: { id: repositoryId } });
//   if (!repository) {
//     console.warn(`${logPrefix} repository ${repositoryId} not found, skipping`);
//     return;
//   }

//   const headSha = pullRequest.headSha ?? undefined;

//   // Idempotency guard — never re-run the full pipeline (and re-publish a Check Run) for a commit
//   // we've already analyzed. Duplicate webhook deliveries are expected (README §66).
//   if (headSha && pullRequest.lastAnalyzedSha === headSha) {
//     console.log(`${logPrefix} pr=${pullRequestId} sha=${headSha} already analyzed, skipping`);
//     return;
//   }

//   const installation = repository.githubInstallationId
//     ? await prisma.gitHubInstallation.findUnique({ where: { id: repository.githubInstallationId } })
//     : null;

//   if (!installation) {
//     console.warn(`${logPrefix} no GitHub installation for repository ${repositoryId}; file-level analysis and Check Run publishing will be skipped`);
//   }

//   // ---- Changed files (Phase 6 classification input) ----
//   let changedFiles: Array<{ filePath: string; additions: number; deletions: number; status: string }> = [];

//   if (installation) {
//     try {
//       const files = await listPullRequestFiles(
//         installation.githubInstallationId,
//         repository.owner,
//         repository.name,
//         pullRequest.number,
//       );
//       changedFiles = files.map((f) => ({
//         filePath: f.filename,
//         additions: f.additions,
//         deletions: f.deletions,
//         status: f.status,
//       }));
//     } catch (error) {
//       console.error(`${logPrefix} failed to fetch PR files:`, (error as Error).message);
//     }
//   }

//   const classifiedFiles = changedFiles.map((file) => ({
//     ...file,
//     sensitiveAreas: classifyFilePaths([file.filePath]),
//   }));

//   // Replace prior per-file analysis for this PR (idempotent on retry).
//   await prisma.codeChange.deleteMany({ where: { pullRequestId } });
//   if (classifiedFiles.length > 0) {
//     await prisma.codeChange.createMany({
//       data: classifiedFiles.map((file) => ({
//         organizationId,
//         pullRequestId,
//         filePath: file.filePath,
//         sensitiveAreas: file.sensitiveAreas,
//         additions: file.additions,
//         deletions: file.deletions,
//         status: file.status.toUpperCase(),
//       })),
//     });
//   }

//   const allSensitiveAreas: SensitiveArea[] = Array.from(
//     new Set(classifiedFiles.flatMap((file) => file.sensitiveAreas)),
//   );

//   // Fall back to the PR-level counts captured at webhook ingestion if the file list couldn't be fetched
//   // (e.g. installation unavailable) — never treat a fetch failure as "zero changes".
//   const additions = changedFiles.length > 0 ? classifiedFiles.reduce((s, f) => s + f.additions, 0) : pullRequest.additions;
//   const deletions = changedFiles.length > 0 ? classifiedFiles.reduce((s, f) => s + f.deletions, 0) : pullRequest.deletions;
//   const changedFileCount = changedFiles.length > 0 ? changedFiles.length : pullRequest.changedFilesCount;

//   // ---- AI provenance (persisted during webhook ingestion, Phase 5) ----
//   const aiActivity = await prisma.aIActivity.findFirst({
//     where: { pullRequestId },
//     orderBy: { createdAt: "desc" },
//   });

//   const aiInvolvement = aiActivity?.involvement ?? "UNKNOWN";
//   const aiConfidence = aiActivity?.confidence ?? 0;

//   // ---- Risk (Phase 7) ----
//   const riskInput: RiskAssessmentInput = {
//     repositoryCriticality: (repository.criticality as RiskAssessmentInput["repositoryCriticality"]) ?? "MEDIUM",
//     aiInvolvement,
//     aiConfidence,
//     sensitiveAreas: allSensitiveAreas,
//     additions,
//     deletions,
//     changedFiles: changedFileCount,
//     dependencyManifestFilesChanged: classifiedFiles.filter((file) => isDependencyManifestPath(file.filePath)).length,
//   };

//   const risk = evaluateRisk(riskInput);

//   await prisma.riskAssessment.create({
//     data: {
//       organizationId,
//       pullRequestId,
//       score: risk.score,
//       level: risk.level,
//       modelVersion: risk.modelVersion,
//       factors: risk.factors as unknown as object,
//       explanation: risk.explanation,
//     },
//   });

//   // ---- Security evidence (Phase 9/10 — mock providers until real integrations land; never equate
//   // NOT_RUN with PASS, README §69) ----
//   const providers = [createCodeQLProvider(), createSemgrepProvider(), createSnykProvider(), createSonarProvider()];

//   const findings: NormalizedSecurityFinding[] = [];
//   const evidence: SecurityEvidence[] = [];

//   for (const provider of providers) {
//     const result = await provider.analyze(pullRequestId);
//     for (const finding of result.findings) {
//       findings.push(normalizeSecurityFinding(finding, provider.name));
//     }
//     evidence.push(...result.evidence);
//   }

//   await prisma.securityFinding.deleteMany({ where: { pullRequestId } });
//   if (findings.length > 0) {
//     await prisma.securityFinding.createMany({
//       data: findings.map((f) => ({
//         organizationId,
//         repositoryId,
//         pullRequestId,
//         provider: f.provider,
//         providerFindingId: f.providerFindingId,
//         category: f.category,
//         severity: f.severity,
//         title: f.title,
//         description: f.description,
//         file: f.file,
//         line: f.line,
//         ruleId: f.ruleId,
//         status: f.status,
//         metadata: f.metadata as object | undefined,
//       })),
//     });
//   }

//   await prisma.evidence.deleteMany({ where: { pullRequestId } });
//   if (evidence.length > 0) {
//     await prisma.evidence.createMany({
//       data: evidence.map((e) => ({
//         organizationId,
//         pullRequestId,
//         repositoryId,
//         type: e.type,
//         status: e.result,
//         source: e.source,
//         metadata: e.metadata as object | undefined,
//       })),
//     });
//   }

//   const evidenceSummary = summarizeEvidence(evidence);

//   // ---- Policy (Phase 8) ----
//   const policyInput: PolicyEvaluationInput = {
//     organizationId,
//     repositoryId,
//     aiInvolvement,
//     aiConfidence,
//     sensitiveAreas: allSensitiveAreas,
//     riskScore: risk.score,
//     riskLevel: risk.level,
//     repositoryCriticality: riskInput.repositoryCriticality,
//   };

//   const policyDecision = evaluatePolicy(policyInput);

//   await prisma.policyDecision.create({
//     data: {
//       organizationId,
//       pullRequestId,
//       action: policyDecision.action,
//       matchedRuleIds: policyDecision.matchedPolicies.map((p) => p.policyId),
//       requiredApprovals: policyDecision.requiredApprovals.map((a) => a.type),
//       explanation: policyDecision.reasons.join(" "),
//     },
//   });

//   // Phase 14: audit logging. Both events are system/automated decisions —
//   // no actorId, since no human made this call.
//   await recordAuditEvent({
//     organizationId,
//     eventType: "POLICY_EVALUATED",
//     metadata: {
//       pullRequestId,
//       action: policyDecision.action,
//       matchedPolicyIds: policyDecision.matchedPolicies.map((p) => p.policyId),
//     },
//   });

//   if (policyDecision.action === "BLOCK") {
//     await recordAuditEvent({
//       organizationId,
//       eventType: "CHANGE_BLOCKED",
//       metadata: { pullRequestId, reasons: policyDecision.reasons },
//     });
//   }

//   // ---- Change Passport (Phase 11) ----
//   const passport = deriveChangePassport(
//     `passport-${pullRequestId}`,
//     organizationId,
//     {
//       pullRequestId,
//       number: pullRequest.number,
//       title: pullRequest.title,
//       author: pullRequest.authorLogin ?? undefined,
//       repositoryName: `${repository.owner}/${repository.name}`,
//     },
//     {
//       involvement: aiInvolvement,
//       agent: aiActivity?.agent,
//       model: aiActivity?.model ?? undefined,
//       confidence: aiConfidence,
//       source: aiActivity?.source ?? "UNKNOWN",
//     },
//     classifiedFiles.map((f) => ({
//       filePath: f.filePath,
//       sensitiveAreas: f.sensitiveAreas,
//       additions: f.additions,
//       deletions: f.deletions,
//     })),
//     {
//       score: risk.score,
//       level: risk.level,
//       modelVersion: risk.modelVersion,
//       factors: risk.factors as unknown as Record<string, unknown>,
//       explanation: risk.explanation,
//     },
//     {
//       action: policyDecision.action,
//       matchedRuleIds: policyDecision.matchedPolicies.map((p) => p.policyId),
//       requiredApprovals: policyDecision.requiredApprovals.map((a) => a.type),
//       explanation: policyDecision.reasons.join(" "),
//     },
//     findings.map((f) => ({ severity: f.severity, category: f.category, title: f.title })),
//     evidenceSummary,
//     [],
//   );

//   const existingPassport = await prisma.changePassport.findFirst({ where: { pullRequestId, organizationId } });

//   const persistedPassport = existingPassport
//     ? await prisma.changePassport.update({
//         where: { id: existingPassport.id },
//         data: {
//           status: passport.status,
//           summary: passport.explanation,
//           payload: passport as unknown as object,
//         },
//       })
//     : await prisma.changePassport.create({
//         data: {
//           organizationId,
//           pullRequestId,
//           status: passport.status,
//           summary: passport.explanation,
//           payload: passport as unknown as object,
//         },
//       });

//   // ---- GitHub Check Run (Phase 12) ----
//   if (installation && headSha) {
//     try {
//       const checkRun = await publishCheckRun({
//         githubInstallationId: installation.githubInstallationId,
//         owner: repository.owner,
//         repo: repository.name,
//         headSha,
//         existingCheckRunId: pullRequest.githubCheckRunId,
//         summaryInput: {
//           aiInvolvement,
//           aiAgent: aiActivity?.agent,
//           aiConfidence,
//           riskScore: risk.score,
//           riskLevel: risk.level,
//           sensitiveAreas: allSensitiveAreas,
//           policyAction: policyDecision.action,
//           policyReasons: policyDecision.reasons,
//           requiredApprovals: policyDecision.requiredApprovals.map((a) => a.type),
//           passportUrl: buildPassportUrl(persistedPassport.id),
//         },
//       });

//       await prisma.pullRequest.update({
//         where: { id: pullRequestId },
//         data: { githubCheckRunId: checkRun.checkRunId, lastAnalyzedSha: headSha },
//       });
//     } catch (error) {
//       console.error(`${logPrefix} failed to publish check run:`, (error as Error).message);
//       // Still mark this SHA analyzed — a failed publish shouldn't cause the whole
//       // pipeline to re-run on every retry; the risk/policy/passport records are valid.
//       await prisma.pullRequest.update({ where: { id: pullRequestId }, data: { lastAnalyzedSha: headSha } });
//     }
//   } else if (headSha) {
//     await prisma.pullRequest.update({ where: { id: pullRequestId }, data: { lastAnalyzedSha: headSha } });
//   }

//   console.log(
//     `${logPrefix} pr=${pullRequestId} risk=${risk.level}(${risk.score}) policy=${policyDecision.action} passport=${persistedPassport.id}`,
//   );
// }
/**
 * PR analysis pipeline (github.pr.analyze).
 *
 * This is the golden-path worker job described in README §38/§90: given a
 * persisted PR, it fetches changed files, classifies sensitive areas,
 * collects security evidence, computes risk (risk-v2), evaluates policy,
 * derives the Change Passport, and publishes a GitHub Check Run.
 *
 * Idempotent: skips re-analysis if `pullRequest.lastAnalyzedSha` already
 * matches the current head SHA (README §66). Per-run outputs (CodeChange,
 * SecurityFinding, Evidence) are replaced rather than appended so retries
 * never accumulate duplicate rows.
 */

import type { Job } from "bullmq";
import {
  assertPullRequestOwnership,
  getPolicyEnforcementApprovalStatuses,
  hashChangePassportRevision,
  prisma,
  recordAuditEvent,
  TenantIsolationError,
  type Prisma,
} from "@ai-sdlc/db";
import {
  classifyFilePaths,
  evaluateRisk,
  isDependencyManifestPath,
  type RepositoryCriticality,
  type RiskAssessmentInput,
  type SensitiveArea,
} from "@ai-sdlc/risk";
import {
  evaluatePolicy,
  parsePolicyCondition,
  resolvePolicyMode,
  type PolicyMode,
  type PolicyEvaluationInput,
  type PolicyCondition,
  type PolicyRule,
} from "@ai-sdlc/policy";
import { inferAIProvenanceFromPullRequest } from "@ai-sdlc/provenance";
import { reserveUsage, resolveOrganizationEntitlements } from "@ai-sdlc/billing";
import { notifyOrganizationRoles } from "../notification-events.js";
import {
  createAzureFoundryCodeReviewProvider,
  createGitHubCodeScanningProvider,
  createSemgrepProvider,
  createSnykProvider,
  createSonarProvider,
  deriveChangePassport,
  normalizeSecurityFinding,
  summarizeEvidence,
  type SecurityEvidence,
  type SecurityFinding as NormalizedSecurityFinding,
} from "@ai-sdlc/security";
import {
  githubApiRequest,
  getGitHubBranchProtection,
  listPullRequestCommits,
  listPullRequestFiles,
  publishCheckRun,
} from "@ai-sdlc/github";
import type { NormalizedCommit } from "@ai-sdlc/source-control";
import type { GitLabConnectionCredentials } from "../gitlab-connection.js";
import { createGitLabClient } from "../gitlab-connection.js";
import type { BitbucketConnectionCredentials } from "../bitbucket-connection.js";
import { createBitbucketClient } from "../bitbucket-connection.js";
import type { AzureDevOpsConnectionCredentials } from "../azure-devops-connection.js";
import { createAzureDevOpsClient } from "../azure-devops-connection.js";
import { JOB_TYPES } from "../config.js";

export interface PullRequestAnalyzeJobData {
  organizationId: string;
  repositoryId: string;
  pullRequestId: string;
  enqueuedAt: string;
  assessmentMode?: boolean;
}

const DASHBOARD_BASE_URL = process.env["DASHBOARD_BASE_URL"] ?? "";

function toJsonInput(value: unknown): Prisma.InputJsonValue {
  const serialized: unknown = JSON.stringify(value);
  if (typeof serialized !== "string") {
    throw new Error("Unable to serialize analysis evidence as JSON.");
  }
  return JSON.parse(serialized) as Prisma.InputJsonValue;
}

function buildPassportUrl(passportId: string): string | undefined {
  if (!DASHBOARD_BASE_URL) {
    return undefined;
  }
  return `${DASHBOARD_BASE_URL.replace(/\/$/, "")}/passports/${passportId}`;
}

export function shouldPublishCheckRun(
  hasInstallation: boolean,
  headSha: string | undefined,
  assessmentMode: boolean,
): boolean {
  return hasInstallation && Boolean(headSha) && !assessmentMode;
}

export function getGitLabFindingEvidenceResult(findingCount: number): "FAIL" | "UNKNOWN" {
  return findingCount > 0 ? "FAIL" : "UNKNOWN";
}

export function getAzureDevOpsFindingEvidenceResult(findingCount: number): "FAIL" | "UNKNOWN" {
  return findingCount > 0 ? "FAIL" : "UNKNOWN";
}

export function buildGitHubCheckProtectionEvidence(input: {
  status: "AVAILABLE" | "UNKNOWN";
  requiredChecks?: string[];
  reason?: string;
  headSha: string;
  targetBranch: string | null;
}): SecurityEvidence {
  const required = input.requiredChecks?.some(
    (check) => check.trim().toLowerCase() === "nomalog security",
  );
  const available = input.status === "AVAILABLE" && Boolean(input.targetBranch);
  return {
    type: "POLICY",
    source: "GitHub required Nomalog Security check",
    result: !available ? "NOT_RUN" : required ? "PASS" : "UNKNOWN",
    timestamp: new Date(),
    metadata: {
      headSha: input.headSha,
      targetBranch: input.targetBranch,
      required: required ?? null,
      reason: !available
        ? (input.reason ??
          "Branch-protection configuration could not be read for the target branch.")
        : required
          ? "Classic branch-protection settings list Nomalog Security as a required check."
          : "The classic branch-protection endpoint does not report all rulesets; absence here cannot establish that no merge gate applies.",
      limitation:
        "This verifies configuration presence only. It does not prove GitHub prevented a merge, account for every ruleset or bypass actor, or establish effective enforcement.",
    },
  };
}

export function getEffectivePolicyMode(mode: PolicyMode, enforcementApproved: boolean): PolicyMode {
  return mode === "ENFORCING" && !enforcementApproved ? "DRY_RUN" : mode;
}

function projectForAzureRepository(owner: string): string {
  return owner.split("/").slice(1).join("/");
}

/**
 * Loads enabled organization policies and applies each policy's persisted
 * mode. Disabled policies have no effect; dry-run policies downgrade BLOCK
 * to REVIEW; enforcing policies retain their configured actions only after
 * the current revision's owner-configured approval quorum is met. Static
 * platform safeguards are added separately by evaluatePolicy and are never
 * disabled by organization policy settings.
 */
async function loadOrganizationPolicyRules(organizationId: string): Promise<PolicyRule[]> {
  const policies = await prisma.policy.findMany({
    where: { organizationId, enabled: true },
    include: { policyRules: { orderBy: { precedence: "desc" } } },
  });
  const enforcingPolicies = policies.filter((policy) => policy.mode === "ENFORCING");
  const approvalStatuses = await getPolicyEnforcementApprovalStatuses({
    prisma,
    organizationId,
    policies: enforcingPolicies,
  });

  return policies.flatMap((policy) => {
    if (policy.mode === "DISABLED") {
      return [];
    }

    const mode = getEffectivePolicyMode(
      policy.mode,
      approvalStatuses.get(policy.id)?.approved ?? false,
    );
    return policy.policyRules.map((rule) => {
      let conditionExpression: PolicyCondition | undefined;
      if (rule.conditionExpression !== null) {
        const parsedCondition = parsePolicyCondition(rule.conditionExpression);
        if (!parsedCondition.valid) {
          throw new Error(
            `Policy rule ${rule.id} has an invalid condition expression: ${parsedCondition.error}`,
          );
        }
        conditionExpression = parsedCondition.condition;
      }

      return {
        id: rule.id,
        name: `${policy.name}: ${rule.name}`,
        conditions: {
          aiInvolved: rule.aiInvolved ?? undefined,
          sensitiveAreasInclude:
            rule.sensitiveAreas.length > 0 ? (rule.sensitiveAreas as SensitiveArea[]) : undefined,
          riskAtLeast: rule.riskAtLeast ?? undefined,
          repositoryCriticalityIn:
            rule.repositoryCriticalityIn.length > 0
              ? (rule.repositoryCriticalityIn as RepositoryCriticality[])
              : undefined,
        },
        conditionExpression,
        action: resolvePolicyMode(rule.action, mode),
        requiredApprovals: rule.requiredApprovals.map((type) => ({
          type,
          description: `${type} required by "${policy.name}".`,
        })),
        reason: rule.reason ?? `Matched organization policy "${policy.name}".`,
      };
    });
  });
}

export async function processPullRequestAnalyze(
  job: Pick<Job<PullRequestAnalyzeJobData>, "data">,
): Promise<void> {
  const { organizationId, repositoryId, pullRequestId } = job.data;
  const logPrefix = `[${JOB_TYPES.PR_ANALYZE}]`;

  let pullRequest;
  try {
    await assertPullRequestOwnership({ organizationId, repositoryId, pullRequestId });
    pullRequest = await prisma.pullRequest.findUnique({ where: { id: pullRequestId } });
  } catch (error) {
    if (error instanceof TenantIsolationError) {
      console.error(`${logPrefix} tenant isolation violation:`, error.message);
      throw error;
    }
    throw error;
  }

  if (!pullRequest) {
    console.warn(`${logPrefix} pull request ${pullRequestId} not found, skipping`);
    return;
  }

  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId },
  });
  if (!repository) {
    console.error(`${logPrefix} repository ${repositoryId} not in organization ${organizationId}`);
    throw new TenantIsolationError(
      `Repository ${repositoryId} not found in organization ${organizationId}`,
    );
  }
  if (!repository.enabled) {
    console.info(`${logPrefix} repository ${repositoryId} is disabled; skipping analysis`);
    return;
  }

  const installation = repository.githubInstallationId
    ? await prisma.gitHubInstallation.findFirst({
        where: {
          id: repository.githubInstallationId,
          organizationId,
          active: true,
        },
      })
    : null;
  const gitLabConnection: GitLabConnectionCredentials | null =
    repository.provider === "GITLAB" && repository.sourceControlConnectionId
      ? await prisma.sourceControlConnection.findFirst({
          where: {
            id: repository.sourceControlConnectionId,
            organizationId,
            provider: "GITLAB",
            active: true,
          },
          select: {
            id: true,
            organizationId: true,
            active: true,
            credentialCiphertext: true,
            scopes: true,
          },
        })
      : null;
  const bitbucketConnection: BitbucketConnectionCredentials | null =
    repository.provider === "BITBUCKET" && repository.sourceControlConnectionId
      ? await prisma.sourceControlConnection.findFirst({
          where: {
            id: repository.sourceControlConnectionId,
            organizationId,
            provider: "BITBUCKET",
            active: true,
          },
          select: {
            id: true,
            organizationId: true,
            active: true,
            credentialCiphertext: true,
            scopes: true,
          },
        })
      : null;
  const azureDevOpsConnection: AzureDevOpsConnectionCredentials | null =
    repository.provider === "AZURE_DEVOPS" && repository.sourceControlConnectionId
      ? await prisma.sourceControlConnection.findFirst({
          where: {
            id: repository.sourceControlConnectionId,
            organizationId,
            provider: "AZURE_DEVOPS",
            active: true,
          },
          select: {
            id: true,
            organizationId: true,
            active: true,
            credentialCiphertext: true,
            scopes: true,
            accountName: true,
          },
        })
      : null;
  if (repository.provider === "GITHUB" && !installation) {
    console.info(`${logPrefix} active GitHub installation unavailable; skipping analysis`);
    return;
  }
  if (repository.provider === "GITLAB" && !gitLabConnection) {
    throw new Error(`Active GitLab connection unavailable for repository ${repositoryId}.`);
  }
  if (repository.provider === "BITBUCKET" && !bitbucketConnection) {
    throw new Error(`Active Bitbucket connection unavailable for repository ${repositoryId}.`);
  }
  if (repository.provider === "AZURE_DEVOPS" && !azureDevOpsConnection) {
    throw new Error(`Active Azure DevOps connection unavailable for repository ${repositoryId}.`);
  }
  if (!["GITHUB", "GITLAB", "BITBUCKET", "AZURE_DEVOPS"].includes(repository.provider)) {
    throw new Error(
      `Source-control provider ${repository.provider} is not supported for analysis.`,
    );
  }
  const gitLabClient =
    repository.provider === "GITLAB" && gitLabConnection
      ? await createGitLabClient(gitLabConnection)
      : null;
  const bitbucketClient =
    repository.provider === "BITBUCKET" && bitbucketConnection
      ? await createBitbucketClient(bitbucketConnection)
      : null;
  const azureDevOpsClient =
    repository.provider === "AZURE_DEVOPS" && azureDevOpsConnection
      ? await createAzureDevOpsClient(azureDevOpsConnection)
      : null;

  const headSha = pullRequest.headSha ?? undefined;

  // Idempotency guard — never re-run the full pipeline (and re-publish a Check Run) for a commit
  // we've already analyzed. Duplicate webhook deliveries are expected (README §66).
  if (!job.data.assessmentMode && headSha && pullRequest.lastAnalyzedSha === headSha) {
    console.log(`${logPrefix} pr=${pullRequestId} sha=${headSha} already analyzed, skipping`);
    return;
  }

  if (!job.data.assessmentMode) {
    const entitlements = await resolveOrganizationEntitlements(organizationId);
    if (!entitlements.entitlements.continuousAnalysis || entitlements.billingAccessOnly) {
      console.info(
        `${logPrefix} continuous analysis is not entitled for organization=${organizationId} plan=${entitlements.effectivePlan}`,
      );
      return;
    }
    const reserved = await reserveUsage(
      organizationId,
      "ANALYSIS_JOB",
      `analysis:${pullRequestId}:${headSha ?? "no-head"}`,
      { pullRequestId, repositoryId },
    );
    if (!reserved) {
      console.warn(
        `${logPrefix} monthly analysis quota reached for organization=${organizationId}`,
      );
      return;
    }
  }

  // ---- Changed files (Phase 6 classification input) ----
  let changedFiles: Array<{
    filePath: string;
    additions: number;
    deletions: number;
    status: string;
    patch?: string;
  }> = [];

  {
    try {
      if (repository.provider === "GITHUB" && installation) {
        const files = await listPullRequestFiles(
          installation.githubInstallationId,
          repository.owner,
          repository.name,
          pullRequest.number,
        );
        changedFiles = files.map((f) => ({
          filePath: f.filename,
          additions: f.additions,
          deletions: f.deletions,
          status: f.status,
          patch: f.patch,
        }));
      } else if (repository.provider === "GITLAB" && gitLabClient && repository.externalId) {
        const collection = await gitLabClient.getMergeRequestFiles(
          repository.externalId,
          pullRequest.number,
        );
        if (!collection.complete) {
          throw new Error(
            "GitLab omitted or truncated one or more merge-request diffs; analysis cannot safely calculate complete change-size risk factors.",
          );
        }
        changedFiles = collection.items.map((file) => ({
          filePath: file.path,
          additions: file.additions ?? 0,
          deletions: file.deletions ?? 0,
          status: file.status,
          patch: file.patch ?? undefined,
        }));
      } else if (repository.provider === "BITBUCKET" && bitbucketClient) {
        const collection = await bitbucketClient.getPullRequestFiles(
          repository.owner,
          repository.name,
          pullRequest.number,
        );
        if (!collection.complete) {
          throw new Error(
            "Bitbucket omitted or truncated pull-request diff data; analysis cannot safely calculate complete change-size risk factors.",
          );
        }
        changedFiles = collection.items.map((file) => ({
          filePath: file.path,
          additions: file.additions ?? 0,
          deletions: file.deletions ?? 0,
          status: file.status,
          patch: file.patch ?? undefined,
        }));
      } else if (repository.provider === "AZURE_DEVOPS" && azureDevOpsClient) {
        const project = projectForAzureRepository(repository.owner);
        if (!repository.externalId || !project) {
          throw new Error(
            "Azure DevOps repository is missing its project or repository identifier.",
          );
        }
        const collection = await azureDevOpsClient.getPullRequestFiles(
          project,
          repository.externalId,
          pullRequest.number,
        );
        if (!collection.complete) {
          throw new Error(
            "Azure DevOps omitted or truncated pull-request diffs; analysis cannot safely calculate complete change-size risk factors.",
          );
        }
        changedFiles = collection.items.map((file) => ({
          filePath: file.path,
          additions: file.additions ?? 0,
          deletions: file.deletions ?? 0,
          status: file.status,
          patch: file.patch ?? undefined,
        }));
      } else {
        throw new Error("The connected source-control repository is missing its provider ID.");
      }
    } catch (error) {
      console.error(`${logPrefix} failed to fetch PR files:`, (error as Error).message);
      throw new Error("Analysis could not retrieve complete changed files for this pull request", {
        cause: error,
      });
    }
  }

  const classifiedFiles = changedFiles.map((file) => ({
    ...file,
    sensitiveAreas: classifyFilePaths([file.filePath]),
  }));

  // Replace prior per-file analysis for this PR (idempotent on retry).
  await prisma.codeChange.deleteMany({ where: { pullRequestId } });
  if (classifiedFiles.length > 0) {
    await prisma.codeChange.createMany({
      data: classifiedFiles.map((file) => ({
        organizationId,
        pullRequestId,
        filePath: file.filePath,
        sensitiveAreas: file.sensitiveAreas,
        additions: file.additions,
        deletions: file.deletions,
        status: file.status.toUpperCase(),
      })),
    });
  }

  const allSensitiveAreas: SensitiveArea[] = Array.from(
    new Set(classifiedFiles.flatMap((file) => file.sensitiveAreas)),
  );

  // Fall back to the PR-level counts captured at webhook ingestion if the file list couldn't be fetched
  // (e.g. installation unavailable) — never treat a fetch failure as "zero changes".
  const additions =
    changedFiles.length > 0
      ? classifiedFiles.reduce((s, f) => s + f.additions, 0)
      : pullRequest.additions;
  const deletions =
    changedFiles.length > 0
      ? classifiedFiles.reduce((s, f) => s + f.deletions, 0)
      : pullRequest.deletions;
  const changedFileCount =
    changedFiles.length > 0 ? changedFiles.length : pullRequest.changedFilesCount;

  // ---- AI provenance (persisted during webhook ingestion, Phase 5) ----
  if (
    (repository.provider === "GITHUB" && installation) ||
    (repository.provider === "BITBUCKET" && bitbucketClient) ||
    (repository.provider === "AZURE_DEVOPS" && azureDevOpsClient && repository.externalId)
  ) {
    try {
      let commits: NormalizedCommit[];
      if (repository.provider === "GITHUB" && installation) {
        commits = (
          await listPullRequestCommits(
            installation.githubInstallationId,
            repository.owner,
            repository.name,
            pullRequest.number,
          )
        ).map((commit) => ({
          provider: "GITHUB",
          sha: commit.sha,
          message: commit.commit.message,
          authorName: null,
          committedAt: null,
          webUrl: null,
          original: {
            provider: "GITHUB",
            externalId: commit.sha,
            collectedAt: new Date().toISOString(),
          },
        }));
      } else if (repository.provider === "BITBUCKET" && bitbucketClient) {
        const collection = await bitbucketClient.listPullRequestCommits(
          repository.owner,
          repository.name,
          pullRequest.number,
        );
        if (!collection.complete) {
          throw new Error("Bitbucket returned incomplete pull-request commit metadata.");
        }
        commits = collection.items;
      } else if (
        repository.provider === "AZURE_DEVOPS" &&
        azureDevOpsClient &&
        repository.externalId
      ) {
        const project = projectForAzureRepository(repository.owner);
        if (!project) throw new Error("Azure DevOps repository project is unavailable.");
        const collection = await azureDevOpsClient.listPullRequestCommits(
          project,
          repository.externalId,
          pullRequest.number,
        );
        if (!collection.complete) {
          throw new Error("Azure DevOps returned incomplete pull-request commit metadata.");
        }
        commits = collection.items;
      } else {
        throw new Error("The connected source-control repository is missing its provider ID.");
      }

      for (const commit of commits) {
        await prisma.commit.upsert({
          where: { repositoryId_sha: { repositoryId, sha: commit.sha } },
          update: {
            message: commit.message,
            authorName: commit.authorName,
            committedAt: commit.committedAt ? new Date(commit.committedAt) : null,
          },
          create: {
            organizationId,
            repositoryId,
            pullRequestId,
            sha: commit.sha,
            message: commit.message,
            authorName: commit.authorName,
            committedAt: commit.committedAt ? new Date(commit.committedAt) : null,
          },
        });
      }

      const commitProvenance = inferAIProvenanceFromPullRequest({
        commitMessages: commits.map((commit) => commit.message),
      });

      if (commitProvenance.involvement === "YES") {
        const currentActivity = await prisma.aIActivity.findFirst({
          where: { organizationId, repositoryId, pullRequestId },
          orderBy: { createdAt: "desc" },
        });
        const provenanceData = {
          agent: commitProvenance.agentName ?? "unknown",
          model: commitProvenance.modelName ?? null,
          involvement: commitProvenance.involvement,
          confidence: commitProvenance.confidence,
          source: commitProvenance.source,
          metadata: {
            evidence: commitProvenance.evidence.map((item) => ({
              reason: item.reason,
              detail: item.detail ?? null,
            })),
          },
          createdAt: new Date(),
        };

        if (currentActivity) {
          await prisma.aIActivity.update({
            where: { id: currentActivity.id },
            data: provenanceData,
          });
        } else {
          await prisma.aIActivity.create({
            data: {
              organizationId,
              repositoryId,
              pullRequestId,
              ...provenanceData,
            },
          });
        }
      }
    } catch (error) {
      console.warn(
        `${logPrefix} could not inspect PR commit provenance:`,
        error instanceof Error ? error.message : error,
      );
      if (job.data.assessmentMode) {
        throw new Error("Assessment could not retrieve commit provenance for this pull request", {
          cause: error,
        });
      }
    }
  }

  const aiActivity = await prisma.aIActivity.findFirst({
    where: { pullRequestId },
    orderBy: { createdAt: "desc" },
  });

  const aiInvolvement = aiActivity?.involvement ?? "UNKNOWN";
  const aiConfidence = aiActivity?.confidence ?? 0;

  // ---- Security evidence: native GitHub Code Scanning and opt-in model review. ----
  const findings: NormalizedSecurityFinding[] = [];
  const evidence: SecurityEvidence[] = [];
  let gitLabPipelines: Awaited<
    ReturnType<NonNullable<typeof gitLabClient>["listMergeRequestPipelines"]>
  > | null = null;

  if (headSha && repository.provider === "GITHUB" && installation) {
    const codeScanningProvider = createGitHubCodeScanningProvider({
      owner: repository.owner,
      repository: repository.name,
      pullRequestNumber: pullRequest.number,
      headSha,
      request: (path) => githubApiRequest(installation.githubInstallationId, path),
    });

    try {
      const result = await codeScanningProvider.analyze(pullRequestId);
      findings.push(
        ...result.findings.map((finding) =>
          normalizeSecurityFinding(finding, codeScanningProvider.name),
        ),
      );
      evidence.push(...result.evidence);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown GitHub API error";
      console.error(`${logPrefix} GitHub Code Scanning lookup failed: ${message}`);
      evidence.push({
        type: "SAST",
        source: codeScanningProvider.name,
        result: "NOT_RUN",
        timestamp: new Date(),
        metadata: { reason: message, headSha },
      });
    }
    const targetBranch = pullRequest.targetBranch ?? repository.defaultBranch;
    if (targetBranch) {
      try {
        const protection = await getGitHubBranchProtection(
          installation.githubInstallationId,
          repository.owner,
          repository.name,
          targetBranch,
        );
        evidence.push(
          buildGitHubCheckProtectionEvidence({
            status: protection.status,
            requiredChecks: protection.status === "AVAILABLE" ? protection.requiredChecks : [],
            reason: protection.status === "UNKNOWN" ? protection.reason : undefined,
            headSha,
            targetBranch,
          }),
        );
      } catch (error) {
        console.error(`${logPrefix} GitHub branch-protection lookup failed`, {
          errorType: error instanceof Error ? error.name : "unknown",
        });
        evidence.push(
          buildGitHubCheckProtectionEvidence({
            status: "UNKNOWN",
            reason: "GitHub branch-protection settings lookup failed.",
            headSha,
            targetBranch,
          }),
        );
      }
    } else {
      evidence.push(
        buildGitHubCheckProtectionEvidence({
          status: "UNKNOWN",
          reason: "Pull request target branch is unavailable.",
          headSha,
          targetBranch: null,
        }),
      );
    }
  } else if (repository.provider === "GITLAB" && gitLabClient && repository.externalId && headSha) {
    try {
      gitLabPipelines = await gitLabClient.listMergeRequestPipelines(
        repository.externalId,
        pullRequest.number,
      );
      const currentHeadPipelines = gitLabPipelines.items.filter(
        (pipeline) => pipeline.sha === headSha,
      );
      if (currentHeadPipelines.length === 0) {
        evidence.push({
          type: "SAST",
          source: "GitLab pipeline vulnerability findings",
          result: "NOT_RUN",
          timestamp: new Date(),
          metadata: {
            headSha,
            reason: "No merge-request pipeline associated with the current head commit was found.",
          },
        });
      } else {
        const reportGroups = new Map<
          string,
          { count: number; complete: boolean; pipelines: string[] }
        >();
        let findingLookupUnavailable = false;
        for (const pipeline of currentHeadPipelines) {
          try {
            const result = await gitLabClient.listPipelineVulnerabilityFindings(
              repository.externalId,
              pipeline.externalId,
              headSha,
            );
            for (const finding of result.items) {
              const reportType = finding.reportType.toLowerCase();
              const category =
                reportType === "dependency_scanning"
                  ? "SCA"
                  : reportType === "secret_detection"
                    ? "SECRET"
                    : reportType === "container_scanning"
                      ? "CONTAINER"
                      : "SAST";
              findings.push(
                normalizeSecurityFinding(
                  {
                    id: finding.id,
                    category,
                    severity: finding.severity,
                    title: finding.title,
                    file: finding.file,
                    line: finding.line,
                    ruleId: finding.ruleId,
                    status: finding.status,
                    metadata: {
                      provider: "GitLab",
                      reportType: finding.reportType,
                      scanner: finding.scanner,
                      pipelineId: finding.pipelineId,
                      headSha: finding.headSha,
                    },
                  },
                  "GitLab Vulnerability Findings",
                ),
              );
              const group = reportGroups.get(reportType) ?? {
                count: 0,
                complete: true,
                pipelines: [],
              };
              group.count += 1;
              group.complete &&= result.complete;
              if (!group.pipelines.includes(pipeline.externalId))
                group.pipelines.push(pipeline.externalId);
              reportGroups.set(reportType, group);
            }
            for (const reportType of ["sast", "dependency_scanning", "container_scanning"]) {
              if (!reportGroups.has(reportType)) {
                reportGroups.set(reportType, {
                  count: 0,
                  complete: result.complete,
                  pipelines: [pipeline.externalId],
                });
              } else {
                const group = reportGroups.get(reportType);
                if (group) {
                  group.complete &&= result.complete;
                  if (!group.pipelines.includes(pipeline.externalId)) {
                    group.pipelines.push(pipeline.externalId);
                  }
                }
              }
            }
          } catch (error) {
            findingLookupUnavailable = true;
            const message =
              error instanceof Error ? error.message : "GitLab vulnerability findings unavailable";
            console.warn(`${logPrefix} GitLab vulnerability findings unavailable: ${message}`);
            evidence.push({
              type: "SAST",
              source: "GitLab pipeline vulnerability findings",
              result: "NOT_RUN",
              timestamp: new Date(),
              metadata: {
                pipelineId: pipeline.externalId,
                headSha,
                reason: message,
              },
            });
          }
        }
        for (const [reportType, group] of reportGroups) {
          const evidenceType =
            reportType === "dependency_scanning"
              ? "SCA"
              : reportType === "secret_detection"
                ? "SECRET_SCAN"
                : "SAST";
          evidence.push({
            type: evidenceType,
            source: `GitLab ${reportType.replaceAll("_", " ")} findings`,
            result: getGitLabFindingEvidenceResult(group.count),
            timestamp: new Date(),
            metadata: {
              findingCount: group.count,
              pipelineIds: group.pipelines,
              headSha,
              complete: group.complete && !findingLookupUnavailable,
              limitation:
                "Findings are restricted to GitLab pipelines whose commit SHA exactly matches the analyzed merge-request head. An empty findings response is UNKNOWN because it does not prove that the corresponding scanner ran.",
            },
          });
        }
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "GitLab merge-request pipelines unavailable";
      console.warn(`${logPrefix} GitLab pipeline security results unavailable: ${message}`);
      evidence.push({
        type: "SAST",
        source: "GitLab pipeline vulnerability findings",
        result: "NOT_RUN",
        timestamp: new Date(),
        metadata: { headSha, reason: message },
      });
    }

    const headPipelines =
      gitLabPipelines?.items.filter((pipeline) => pipeline.sha === headSha) ?? [];
    let secretScanRecorded = false;
    for (const pipeline of headPipelines) {
      try {
        const jobs = await gitLabClient.listPipelineJobs(
          repository.externalId,
          pipeline.externalId,
        );
        const scanJobs = jobs.items.filter((job) => job.name === "secret_detection");
        if (scanJobs.length === 0) continue;
        secretScanRecorded = true;
        for (const job of scanJobs) {
          if (job.status.toLowerCase() !== "success") {
            evidence.push({
              type: "SECRET_SCAN",
              source: "GitLab Secret Detection",
              result: ["failed", "canceled", "cancelled"].includes(job.status.toLowerCase())
                ? "FAIL"
                : "UNKNOWN",
              timestamp: new Date(),
              metadata: {
                jobId: job.id,
                pipelineId: pipeline.externalId,
                headSha,
                jobStatus: job.status,
                limitation:
                  "A secret-detection job must complete successfully for its report to be evaluated.",
              },
            });
            continue;
          }
          const report = await gitLabClient.getSecretDetectionReport(
            repository.externalId,
            String(job.id),
            pipeline.externalId,
            headSha,
          );
          for (const finding of report.items) {
            findings.push(
              normalizeSecurityFinding(
                {
                  id: finding.id,
                  category: "SECRET",
                  severity: finding.severity,
                  title: finding.title,
                  file: finding.file,
                  line: finding.line,
                  ruleId: finding.ruleId,
                  status: finding.status,
                  metadata: {
                    provider: "GitLab Secret Detection",
                    pipelineId: finding.pipelineId,
                    headSha: finding.headSha,
                  },
                },
                "GitLab Secret Detection",
              ),
            );
          }
          evidence.push({
            type: "SECRET_SCAN",
            source: "GitLab Secret Detection",
            result: report.items.length > 0 ? "FAIL" : "PASS",
            timestamp: new Date(),
            metadata: {
              findingCount: report.items.length,
              pipelineId: pipeline.externalId,
              jobId: job.id,
              headSha,
              complete: report.complete,
              secretValuesPersisted: false,
            },
          });
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "GitLab Secret Detection report unavailable";
        console.warn(`${logPrefix} GitLab Secret Detection report unavailable: ${message}`);
        secretScanRecorded = true;
        evidence.push({
          type: "SECRET_SCAN",
          source: "GitLab Secret Detection",
          result: "NOT_RUN",
          timestamp: new Date(),
          metadata: { pipelineId: pipeline.externalId, headSha, reason: message },
        });
      }
    }
    if (!secretScanRecorded) {
      evidence.push({
        type: "SECRET_SCAN",
        source: "GitLab Secret Detection",
        result: "NOT_RUN",
        timestamp: new Date(),
        metadata: {
          headSha,
          reason:
            headPipelines.length === 0
              ? "No pipeline for the current head commit was available."
              : "No successful secret_detection job was found in current-head pipelines.",
        },
      });
    }
  } else if (repository.provider === "AZURE_DEVOPS" && azureDevOpsClient) {
    const securityEvidenceTypes = [
      {
        alertType: "code",
        evidenceType: "SAST",
        source: "Azure DevOps Advanced Security code alerts",
      },
      {
        alertType: "dependency",
        evidenceType: "SCA",
        source: "Azure DevOps Advanced Security dependency alerts",
      },
      {
        alertType: "secret",
        evidenceType: "SECRET_SCAN",
        source: "Azure DevOps Advanced Security secret alerts",
      },
    ] as const;
    const hasAdvancedSecurityScope =
      azureDevOpsConnection?.scopes.some((scope) => scope.toLowerCase() === "vso.advsec") ?? false;
    if (hasAdvancedSecurityScope && repository.externalId) {
      try {
        const alerts = await azureDevOpsClient.listSecurityAlerts(
          projectForAzureRepository(repository.owner),
          repository.externalId,
        );
        for (const entry of securityEvidenceTypes) {
          const findingCount = alerts.items.filter(
            (alert) => alert.type === entry.alertType,
          ).length;
          evidence.push({
            type: entry.evidenceType,
            source: entry.source,
            result: getAzureDevOpsFindingEvidenceResult(findingCount),
            timestamp: new Date(),
            metadata: {
              findingCount,
              complete: alerts.complete,
              scope: "repository-current-active-alerts",
              limitation:
                "An empty active-alert result does not prove the corresponding scanner is enabled or complete; repository alerts are not attributed to this pull request or historical head.",
            },
          });
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Azure DevOps Advanced Security alerts unavailable";
        for (const entry of securityEvidenceTypes) {
          evidence.push({
            type: entry.evidenceType,
            source: entry.source,
            result: "NOT_RUN",
            timestamp: new Date(),
            metadata: { reason: message },
          });
        }
      }
    } else {
      const reason = hasAdvancedSecurityScope
        ? "The Azure DevOps repository is unavailable for Advanced Security alert collection."
        : "The Azure DevOps connection lacks vso.advsec; reconnect and consent to the Advanced Security read permission.";
      for (const entry of securityEvidenceTypes) {
        evidence.push({
          type: entry.evidenceType,
          source: entry.source,
          result: "NOT_RUN",
          timestamp: new Date(),
          metadata: { reason },
        });
      }
    }
  } else {
    evidence.push({
      type: "SAST",
      source:
        repository.provider === "GITLAB"
          ? "GitLab security findings"
          : repository.provider === "BITBUCKET"
            ? "Bitbucket Cloud security findings"
            : repository.provider === "AZURE_DEVOPS"
              ? "Azure DevOps security findings"
              : "GitHub Code Scanning / CodeQL",
      result: "NOT_RUN",
      timestamp: new Date(),
      metadata: {
        reason:
          repository.provider === "GITLAB"
            ? "GitLab project, pipeline, or merge-request head information is unavailable for native security result collection."
            : repository.provider === "BITBUCKET"
              ? "Bitbucket Cloud native security findings are not integrated."
              : repository.provider === "AZURE_DEVOPS"
                ? "The Azure DevOps connection or repository is unavailable for native security findings."
                : !headSha
                  ? "The pull request has no head commit SHA to scan."
                  : "An active GitHub installation is unavailable.",
      },
    });
  }

  const aiReviewProvider = createAzureFoundryCodeReviewProvider({
    enabled: process.env["AI_CODE_REVIEW_ENABLED"] === "true",
    endpoint: process.env["AZURE_OPENAI_BASE_URL"],
    apiKey: process.env["AZURE_OPENAI_API_KEY"],
    model: process.env["AZURE_OPENAI_MODEL"],
    files: changedFiles.map((file) => ({ path: file.filePath, patch: file.patch })),
  });
  try {
    const result = await aiReviewProvider.analyze(pullRequestId);
    findings.push(
      ...result.findings.map((finding) => normalizeSecurityFinding(finding, aiReviewProvider.name)),
    );
    evidence.push(...result.evidence);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown model provider error";
    console.error(`${logPrefix} Azure AI Foundry review failed: ${message}`);
    evidence.push({
      type: "SECURITY_REVIEW",
      source: aiReviewProvider.name,
      result: "NOT_RUN",
      timestamp: new Date(),
      metadata: { reason: message },
    });
  }

  const providers = [createSemgrepProvider(), createSnykProvider(), createSonarProvider()];
  for (const provider of providers) {
    const result = await provider.analyze(pullRequestId);
    for (const finding of result.findings) {
      findings.push(normalizeSecurityFinding(finding, provider.name));
    }
    evidence.push(...result.evidence);
  }

  if (repository.provider === "GITLAB" && gitLabClient && repository.externalId) {
    try {
      const approvals = await gitLabClient.listMergeRequestApprovals(
        repository.externalId,
        pullRequest.number,
      );
      evidence.push({
        type: "HUMAN_REVIEW",
        source: "GitLab merge-request approvals",
        result: "UNKNOWN",
        timestamp: new Date(),
        metadata: {
          approvalCount: approvals.items.length,
          complete: approvals.complete,
          approvals: approvals.items.map((approval) => ({
            evidenceReference: approval.original.externalId,
            submittedAt: approval.submittedAt,
          })),
          limitation:
            "GitLab approval records from this endpoint are not linked to the current merge-request head, so they cannot establish current-head approval coverage.",
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown GitLab approval retrieval error";
      console.warn(`${logPrefix} GitLab approval evidence unavailable: ${message}`);
      evidence.push({
        type: "HUMAN_REVIEW",
        source: "GitLab merge-request approvals",
        result: "NOT_RUN",
        timestamp: new Date(),
        metadata: { reason: message },
      });
    }

    try {
      const pipelines =
        gitLabPipelines ??
        (await gitLabClient.listMergeRequestPipelines(repository.externalId, pullRequest.number));
      gitLabPipelines = pipelines;
      const statuses = pipelines.items.map((pipeline) => pipeline.status.toLowerCase());
      const result =
        !pipelines.complete || statuses.length === 0
          ? "UNKNOWN"
          : statuses.some((status) => ["failed", "canceled", "cancelled"].includes(status))
            ? "FAIL"
            : statuses.every((status) => status === "success")
              ? "PASS"
              : "UNKNOWN";
      evidence.push({
        type: "CI",
        source: "GitLab merge-request pipelines",
        result,
        timestamp: new Date(),
        metadata: {
          complete: pipelines.complete,
          pipelines: pipelines.items.map((pipeline) => ({
            id: pipeline.externalId,
            status: pipeline.status,
            url: pipeline.webUrl,
            sha: pipeline.sha,
          })),
          limitation:
            "A PASS requires every returned associated pipeline to report success; an empty list or non-terminal status is UNKNOWN.",
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown GitLab pipeline retrieval error";
      console.warn(`${logPrefix} GitLab pipeline evidence unavailable: ${message}`);
      evidence.push({
        type: "CI",
        source: "GitLab merge-request pipelines",
        result: "NOT_RUN",
        timestamp: new Date(),
        metadata: { reason: message },
      });
    }

    try {
      const branches = await gitLabClient.listProtectedBranches(repository.externalId);
      const targetBranch = pullRequest.targetBranch ?? repository.defaultBranch;
      const protectedTarget = targetBranch
        ? branches.items.find((branch) => branch.name === targetBranch)
        : undefined;
      const wildcardMayApply =
        !protectedTarget &&
        Boolean(targetBranch) &&
        branches.items.some((branch) => /[*?]/.test(branch.name));
      const policyResult =
        !branches.complete || !targetBranch
          ? "UNKNOWN"
          : wildcardMayApply
            ? "UNKNOWN"
            : !protectedTarget || protectedTarget.allowForcePush
              ? "FAIL"
              : "PASS";
      evidence.push({
        type: "POLICY",
        source: "GitLab protected-branch settings",
        result: policyResult,
        timestamp: new Date(),
        metadata: {
          targetBranch: targetBranch ?? null,
          protected: Boolean(protectedTarget),
          wildcardRuleMayApply: wildcardMayApply,
          allowForcePush: protectedTarget?.allowForcePush ?? null,
          codeOwnerApprovalRequired: protectedTarget?.codeOwnerApprovalRequired ?? null,
          pushAccessLevels: protectedTarget?.pushAccessLevels ?? [],
          mergeAccessLevels: protectedTarget?.mergeAccessLevels ?? [],
          complete: branches.complete,
          limitation:
            "This evidence covers the exact target branch only. Wildcard inheritance and project-level approval rules are not inferred.",
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "GitLab protected-branch settings unavailable";
      console.warn(`${logPrefix} GitLab protected-branch evidence unavailable: ${message}`);
      evidence.push({
        type: "POLICY",
        source: "GitLab protected-branch settings",
        result: "NOT_RUN",
        timestamp: new Date(),
        metadata: { reason: message },
      });
    }
  } else if (repository.provider === "BITBUCKET" && bitbucketClient) {
    try {
      const reviews = await bitbucketClient.listPullRequestReviews(
        repository.owner,
        repository.name,
        pullRequest.number,
      );
      evidence.push({
        type: "HUMAN_REVIEW",
        source: "Bitbucket Cloud pull-request participants",
        result: "UNKNOWN",
        timestamp: new Date(),
        metadata: {
          complete: reviews.complete,
          approvalsReported: reviews.items.filter((review) => review.state === "APPROVED").length,
          participants: reviews.items.map((review) => ({
            actor: review.actor,
            state: review.state,
            evidenceReference: review.original.externalId,
          })),
          limitation:
            "Bitbucket participant approval state is not linked to a review timestamp or current head commit, so it cannot establish current-head approval coverage.",
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown Bitbucket participant retrieval error";
      console.warn(`${logPrefix} Bitbucket participant evidence unavailable: ${message}`);
      evidence.push({
        type: "HUMAN_REVIEW",
        source: "Bitbucket Cloud pull-request participants",
        result: "NOT_RUN",
        timestamp: new Date(),
        metadata: { reason: message },
      });
    }

    if (headSha) {
      try {
        const pipelines = await bitbucketClient.listPipelines(
          repository.owner,
          repository.name,
          headSha,
        );
        const currentHeadPipelines = pipelines.items.filter((pipeline) => pipeline.sha === headSha);
        const statuses = currentHeadPipelines.map((pipeline) => pipeline.status.toLowerCase());
        const result =
          !pipelines.complete || statuses.length === 0
            ? "UNKNOWN"
            : statuses.some((status) => /failed|error|stopped|cancelled|canceled/.test(status))
              ? "FAIL"
              : statuses.every((status) => /successful/.test(status))
                ? "PASS"
                : "UNKNOWN";
        evidence.push({
          type: "CI",
          source: "Bitbucket Cloud Pipelines",
          result,
          timestamp: new Date(),
          metadata: {
            headSha,
            complete: pipelines.complete,
            pipelines: currentHeadPipelines.map((pipeline) => ({
              id: pipeline.externalId,
              status: pipeline.status,
              url: pipeline.webUrl,
              sha: pipeline.sha,
            })),
            limitation:
              "Only pipelines matching the current pull-request head are included. Empty, incomplete, or non-terminal results are UNKNOWN.",
          },
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown Bitbucket pipeline retrieval error";
        console.warn(`${logPrefix} Bitbucket pipeline evidence unavailable: ${message}`);
        evidence.push({
          type: "CI",
          source: "Bitbucket Cloud Pipelines",
          result: "NOT_RUN",
          timestamp: new Date(),
          metadata: { headSha, reason: message },
        });
      }
    } else {
      evidence.push({
        type: "CI",
        source: "Bitbucket Cloud Pipelines",
        result: "NOT_RUN",
        timestamp: new Date(),
        metadata: { reason: "The pull request has no head commit SHA." },
      });
    }

    try {
      const restrictions = await bitbucketClient.listBranchRestrictions(
        repository.owner,
        repository.name,
      );
      const targetBranch = pullRequest.targetBranch ?? repository.defaultBranch;
      evidence.push({
        type: "POLICY",
        source: "Bitbucket Cloud branch restrictions",
        result: "UNKNOWN",
        timestamp: new Date(),
        metadata: {
          targetBranch: targetBranch ?? null,
          complete: restrictions.complete,
          restrictions: restrictions.items,
          limitation:
            "Branch-restriction configurations are collected, but rule semantics, wildcard matching, and effective enforcement are not verified; configuration presence is not reported as a policy pass.",
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Bitbucket branch restriction data unavailable";
      console.warn(`${logPrefix} Bitbucket branch restriction evidence unavailable: ${message}`);
      evidence.push({
        type: "POLICY",
        source: "Bitbucket Cloud branch restrictions",
        result: "NOT_RUN",
        timestamp: new Date(),
        metadata: { reason: message },
      });
    }
  } else if (repository.provider === "AZURE_DEVOPS" && azureDevOpsClient) {
    const project = projectForAzureRepository(repository.owner);
    try {
      const reviews = await azureDevOpsClient.listPullRequestReviews(
        project,
        repository.externalId ?? "",
        pullRequest.number,
      );
      evidence.push({
        type: "HUMAN_REVIEW",
        source: "Azure DevOps pull-request reviewer votes",
        result: "UNKNOWN",
        timestamp: new Date(),
        metadata: {
          complete: reviews.complete,
          approvalsReported: reviews.items.filter((review) => review.state === "APPROVED").length,
          reviewers: reviews.items.map((review) => ({
            actor: review.actor,
            state: review.state,
            evidenceReference: review.original.externalId,
          })),
          limitation:
            "Azure DevOps reviewer votes are not tied to an event timestamp or current pull-request iteration, so they do not establish current-head approval coverage.",
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Azure DevOps reviewer data unavailable";
      evidence.push({
        type: "HUMAN_REVIEW",
        source: "Azure DevOps pull-request reviewer votes",
        result: "NOT_RUN",
        timestamp: new Date(),
        metadata: { reason: message },
      });
    }

    try {
      const statuses = await azureDevOpsClient.listPullRequestStatuses(
        project,
        repository.externalId ?? "",
        pullRequest.number,
      );
      evidence.push({
        type: "CI",
        source: "Azure DevOps pull-request statuses",
        result: "UNKNOWN",
        timestamp: new Date(),
        metadata: {
          complete: statuses.complete,
          statuses: statuses.items.map((status) => ({
            id: status.externalId,
            status: status.status,
            ref: status.ref,
            url: status.webUrl,
          })),
          limitation:
            "Pull-request status records do not provide a complete pipeline inventory or a verified current-head SHA; they are not interpreted as a pass or failure.",
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Azure DevOps statuses unavailable";
      evidence.push({
        type: "CI",
        source: "Azure DevOps pull-request statuses",
        result: "NOT_RUN",
        timestamp: new Date(),
        metadata: { reason: message },
      });
    }

    try {
      const policies = await azureDevOpsClient.listBranchPolicies(project);
      const targetBranch = pullRequest.targetBranch ?? repository.defaultBranch;
      const targetRef = targetBranch ? `refs/heads/${targetBranch}` : null;
      const exactPolicies = targetRef
        ? policies.items.filter((policy) => policy.branchRef === targetRef)
        : [];
      evidence.push({
        type: "POLICY",
        source: "Azure DevOps branch policy configurations",
        result: "UNKNOWN",
        timestamp: new Date(),
        metadata: {
          targetBranch: targetBranch ?? null,
          complete: policies.complete,
          policies: exactPolicies.map((policy) => ({
            id: policy.id,
            name: policy.name,
            enabled: policy.enabled,
            blocking: policy.blocking,
            branchRef: policy.branchRef,
          })),
          limitation:
            "Policy configurations are collected for exact branch scopes only. The adapter does not yet evaluate individual policy semantics, wildcard inheritance, or enforcement outcomes.",
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Azure DevOps policy data unavailable";
      evidence.push({
        type: "POLICY",
        source: "Azure DevOps branch policy configurations",
        result: "NOT_RUN",
        timestamp: new Date(),
        metadata: { reason: message },
      });
    }
  }

  await prisma.$transaction(
    async (tx) => {
      const latestPullRequest = await tx.pullRequest.findUnique({
        where: { id: pullRequestId },
        select: { headSha: true },
      });
      if (!latestPullRequest || latestPullRequest.headSha !== (headSha ?? null)) {
        throw new Error("Pull-request head changed during evidence collection; retry analysis.");
      }
      await tx.securityFinding.deleteMany({ where: { pullRequestId } });
      if (findings.length > 0) {
        await tx.securityFinding.createMany({
          data: findings.map((finding) => ({
            organizationId,
            repositoryId,
            pullRequestId,
            provider: finding.provider,
            providerFindingId: finding.providerFindingId,
            category: finding.category,
            severity: finding.severity,
            title: finding.title,
            description: finding.description,
            file: finding.file,
            line: finding.line,
            ruleId: finding.ruleId,
            status: finding.status,
            metadata: toJsonInput({ ...(finding.metadata ?? {}), headSha: headSha ?? null }),
          })),
        });
      }
      await tx.evidence.deleteMany({ where: { pullRequestId } });
      if (evidence.length > 0) {
        await tx.evidence.createMany({
          data: evidence.map((item) => ({
            organizationId,
            pullRequestId,
            repositoryId,
            headSha: headSha ?? null,
            type: item.type,
            status: item.result,
            source: item.source,
            metadata: item.metadata ? toJsonInput(item.metadata) : undefined,
          })),
        });
      }
    },
    { isolationLevel: "Serializable" },
  );

  const evidenceSummary = summarizeEvidence(evidence);

  // ---- Risk (Phase 7) ----
  const riskInput: RiskAssessmentInput = {
    repositoryCriticality: repository.criticality as RiskAssessmentInput["repositoryCriticality"],
    aiInvolvement,
    aiConfidence,
    sensitiveAreas: allSensitiveAreas,
    additions,
    deletions,
    changedFiles: changedFileCount,
    dependencyManifestFilesChanged: classifiedFiles.filter((file) =>
      isDependencyManifestPath(file.filePath),
    ).length,
    securityFindings: (["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"] as const).map((severity) => ({
      severity,
      count: findings.filter((finding) => finding.severity === severity).length,
    })),
    evidenceSummary,
  };

  const risk = evaluateRisk(riskInput);

  await prisma.riskAssessment.create({
    data: {
      organizationId,
      pullRequestId,
      score: risk.score,
      level: risk.level,
      modelVersion: risk.modelVersion,
      factors: toJsonInput(risk.factors),
      explanation: risk.explanation,
    },
  });

  // ---- Policy (Phase 8) ----
  const policyInput: PolicyEvaluationInput = {
    organizationId,
    repositoryId,
    aiInvolvement,
    aiConfidence,
    sensitiveAreas: allSensitiveAreas,
    riskScore: risk.score,
    riskLevel: risk.level,
    repositoryCriticality: riskInput.repositoryCriticality,
  };

  const policyDecision = evaluatePolicy(
    policyInput,
    await loadOrganizationPolicyRules(organizationId),
  );

  await prisma.policyDecision.create({
    data: {
      organizationId,
      pullRequestId,
      action: policyDecision.action,
      matchedRuleIds: policyDecision.matchedPolicies.map((p) => p.policyId),
      requiredApprovals: policyDecision.requiredApprovals.map((a) => a.type),
      explanation: policyDecision.reasons.join(" "),
    },
  });

  if (!job.data.assessmentMode) {
    try {
      const highFindings = findings.filter((finding) =>
        ["HIGH", "CRITICAL"].includes(finding.severity),
      );
      if (highFindings.length > 0) {
        const severeCount = highFindings.filter(
          (finding) => finding.severity === "CRITICAL",
        ).length;
        await notifyOrganizationRoles({
          organizationId,
          roles: ["OWNER", "ADMIN", "SECURITY"],
          type: "SECURITY_FINDING_HIGH",
          title:
            severeCount > 0
              ? "Critical security finding detected"
              : "High security findings detected",
          body: `${highFindings.length} new high or critical finding${highFindings.length === 1 ? "" : "s"} detected in ${repository.owner}/${repository.name} pull request #${pullRequest.number}.`,
          href: `/dashboard/findings`,
          dedupeKey: `security-finding:${pullRequestId}:${headSha ?? pullRequest.updatedAt.toISOString()}`,
        });
      }
      if (policyDecision.action === "BLOCK") {
        await notifyOrganizationRoles({
          organizationId,
          roles: ["OWNER", "ADMIN", "SECURITY"],
          type: "POLICY_VIOLATION",
          title: "Policy blocked a change",
          body: `A policy decision blocked ${repository.owner}/${repository.name} pull request #${pullRequest.number}.`,
          href: `/dashboard/changes/${pullRequestId}`,
          dedupeKey: `policy-block:${pullRequestId}:${headSha ?? pullRequest.updatedAt.toISOString()}`,
        });
      }
    } catch (error) {
      console.error(`${logPrefix} notification event creation failed`, error);
    }
  }

  // Phase 14: audit logging. Both events are system/automated decisions —
  // no actorId, since no human made this call.
  await recordAuditEvent({
    organizationId,
    eventType: "POLICY_EVALUATED",
    metadata: {
      pullRequestId,
      action: policyDecision.action,
      matchedPolicyIds: policyDecision.matchedPolicies.map((p) => p.policyId),
      indeterminatePolicyIds: policyDecision.indeterminatePolicies.map((p) => p.policyId),
    },
  });

  if (policyDecision.action === "BLOCK") {
    await recordAuditEvent({
      organizationId,
      eventType: "CHANGE_BLOCKED",
      metadata: { pullRequestId, reasons: policyDecision.reasons },
    });
  }

  // ---- Change Passport (Phase 11) ----
  const passport = deriveChangePassport(
    `passport-${pullRequestId}`,
    organizationId,
    {
      pullRequestId,
      number: pullRequest.number,
      title: pullRequest.title,
      author: pullRequest.authorLogin ?? undefined,
      repositoryName: `${repository.owner}/${repository.name}`,
    },
    {
      involvement: aiInvolvement,
      agent: aiActivity?.agent,
      model: aiActivity?.model ?? undefined,
      confidence: aiConfidence,
      source: aiActivity?.source ?? "UNKNOWN",
    },
    classifiedFiles.map((f) => ({
      filePath: f.filePath,
      sensitiveAreas: f.sensitiveAreas,
      additions: f.additions,
      deletions: f.deletions,
    })),
    {
      score: risk.score,
      level: risk.level,
      modelVersion: risk.modelVersion,
      factors: risk.factors as unknown as Record<string, unknown>,
      explanation: risk.explanation,
    },
    {
      action: policyDecision.action,
      matchedRuleIds: policyDecision.matchedPolicies.map((p) => p.policyId),
      requiredApprovals: policyDecision.requiredApprovals.map((a) => a.type),
      explanation: policyDecision.reasons.join(" "),
    },
    findings.map((f) => ({ severity: f.severity, category: f.category, title: f.title })),
    evidenceSummary,
    [],
  );

  const persistedPassport = await prisma.$transaction(async (tx) => {
    const existingPassport = await tx.changePassport.findFirst({
      where: { pullRequestId, organizationId },
    });
    const currentPassport = existingPassport
      ? await tx.changePassport.update({
          where: { id: existingPassport.id },
          data: {
            status: passport.status,
            summary: passport.explanation,
            payload: toJsonInput(passport),
          },
        })
      : await tx.changePassport.create({
          data: {
            organizationId,
            pullRequestId,
            status: passport.status,
            summary: passport.explanation,
            payload: toJsonInput(passport),
          },
        });

    await tx.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_advisory_xact_lock(hashtext(${currentPassport.id})) IS NULL AS locked
    `;
    const [
      sourceChange,
      commits,
      aiActivities,
      provenanceSignals,
      riskAssessments,
      policyDecisions,
      reviews,
      evidenceRows,
      findingRows,
      codeChanges,
    ] = await Promise.all([
      tx.pullRequest.findUnique({
        where: { id: pullRequestId },
        select: {
          id: true,
          provider: true,
          externalId: true,
          number: true,
          title: true,
          headSha: true,
          sourceBranch: true,
          targetBranch: true,
          repository: { select: { provider: true, owner: true, name: true } },
        },
      }),
      tx.commit.findMany({
        where: { pullRequestId },
        orderBy: [{ committedAt: "asc" }, { sha: "asc" }],
        select: { sha: true, authorName: true, committedAt: true },
      }),
      tx.aIActivity.findMany({
        where: { pullRequestId },
        orderBy: { createdAt: "asc" },
        select: {
          agent: true,
          model: true,
          involvement: true,
          confidence: true,
          source: true,
          createdAt: true,
        },
      }),
      tx.provenanceSignal.findMany({
        where: { pullRequestId },
        orderBy: { createdAt: "asc" },
        select: {
          signalSource: true,
          sourceType: true,
          signalType: true,
          classification: true,
          verificationStatus: true,
          evidenceReference: true,
          evidenceAt: true,
          confidence: true,
          limitations: true,
          createdAt: true,
        },
      }),
      tx.riskAssessment.findMany({
        where: { pullRequestId },
        orderBy: { createdAt: "asc" },
        select: { level: true, score: true, modelVersion: true, factors: true, createdAt: true },
      }),
      tx.policyDecision.findMany({
        where: { pullRequestId },
        orderBy: { createdAt: "asc" },
        select: {
          action: true,
          matchedRuleIds: true,
          requiredApprovals: true,
          explanation: true,
          createdAt: true,
        },
      }),
      tx.review.findMany({
        where: { pullRequestId },
        orderBy: { createdAt: "asc" },
        select: {
          reviewerId: true,
          reviewedHeadSha: true,
          status: true,
          decision: true,
          completedAt: true,
          createdAt: true,
        },
      }),
      tx.evidence.findMany({
        where: { pullRequestId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          type: true,
          status: true,
          source: true,
          externalRef: true,
          createdAt: true,
        },
      }),
      tx.securityFinding.findMany({
        where: { pullRequestId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          provider: true,
          category: true,
          severity: true,
          title: true,
          status: true,
          createdAt: true,
        },
      }),
      tx.codeChange.findMany({
        where: { pullRequestId },
        orderBy: { filePath: "asc" },
        select: {
          filePath: true,
          sensitiveAreas: true,
          additions: true,
          deletions: true,
          status: true,
        },
      }),
    ]);
    const evidenceSnapshot = {
      sourceChange,
      commits,
      aiActivities,
      provenanceSignals,
      riskAssessments,
      policyDecisions,
      reviews,
      evidence: evidenceRows,
      findings: findingRows,
      changedFiles: codeChanges,
    };
    const latestRevision = await tx.changePassportRevision.findFirst({
      where: { passportId: currentPassport.id },
      orderBy: { revision: "desc" },
      select: { revision: true, contentHash: true },
    });
    const revision = (latestRevision?.revision ?? 0) + 1;
    const createdAt = new Date();
    const serializedPassport = toJsonInput(passport);
    const serializedEvidenceSnapshot = toJsonInput(evidenceSnapshot);
    const envelope = {
      passportId: currentPassport.id,
      organizationId,
      schemaVersion: 1,
      revision,
      previousHash: latestRevision?.contentHash ?? null,
      createdAt: createdAt.toISOString(),
      payload: serializedPassport,
      evidenceSnapshot: serializedEvidenceSnapshot,
    };
    await tx.changePassportRevision.create({
      data: {
        ...envelope,
        evidenceSnapshot: serializedEvidenceSnapshot,
        contentHash: hashChangePassportRevision(envelope),
        createdAt,
      },
    });
    return currentPassport;
  });

  // ---- GitHub Check Run (Phase 12) ----
  if (
    headSha &&
    installation &&
    shouldPublishCheckRun(true, headSha, Boolean(job.data.assessmentMode))
  ) {
    try {
      const checkRun = await publishCheckRun({
        githubInstallationId: installation.githubInstallationId,
        owner: repository.owner,
        repo: repository.name,
        headSha,
        existingCheckRunId: pullRequest.githubCheckRunId,
        summaryInput: {
          aiInvolvement,
          aiAgent: aiActivity?.agent,
          aiConfidence,
          riskScore: risk.score,
          riskLevel: risk.level,
          sensitiveAreas: allSensitiveAreas,
          policyAction: policyDecision.action,
          policyReasons: policyDecision.reasons,
          requiredApprovals: policyDecision.requiredApprovals.map((a) => a.type),
          passportUrl: buildPassportUrl(persistedPassport.id),
        },
      });

      await prisma.pullRequest.update({
        where: { id: pullRequestId },
        data: { githubCheckRunId: checkRun.checkRunId, lastAnalyzedSha: headSha },
      });
    } catch (error) {
      console.error(`${logPrefix} failed to publish check run:`, (error as Error).message);
      // Still mark this SHA analyzed — a failed publish shouldn't cause the whole
      // pipeline to re-run on every retry; the risk/policy/passport records are valid.
      await prisma.pullRequest.update({
        where: { id: pullRequestId },
        data: { lastAnalyzedSha: headSha },
      });
    }
  } else if (headSha && !job.data.assessmentMode) {
    await prisma.pullRequest.update({
      where: { id: pullRequestId },
      data: { lastAnalyzedSha: headSha },
    });
  }

  console.log(
    `${logPrefix} pr=${pullRequestId} risk=${risk.level}(${risk.score}) policy=${policyDecision.action} passport=${persistedPassport.id}`,
  );
}
