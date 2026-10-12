// /**
//  * PR analysis pipeline (github.pr.analyze).
//  *
//  * This is the golden-path worker job described in README §38/§90: given a
//  * persisted PR, it fetches changed files, classifies sensitive areas,
//  * computes risk (risk-v1), evaluates policy, collects security evidence,
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
//     newDependencies: classifiedFiles.filter((f) => f.sensitiveAreas.includes("DEPENDENCIES")).length,
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
 * computes risk (risk-v1), evaluates policy, collects security evidence,
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
  prisma,
  recordAuditEvent,
  TenantIsolationError,
} from "@ai-sdlc/db";
import {
  classifyFilePaths,
  evaluateRisk,
  type RepositoryCriticality,
  type RiskAssessmentInput,
  type SensitiveArea,
} from "@ai-sdlc/risk";
import { evaluatePolicy, type PolicyEvaluationInput, type PolicyRule } from "@ai-sdlc/policy";
import {
  createCodeQLProvider,
  createSemgrepProvider,
  createSnykProvider,
  createSonarProvider,
  deriveChangePassport,
  normalizeSecurityFinding,
  summarizeEvidence,
  type SecurityEvidence,
  type SecurityFinding as NormalizedSecurityFinding,
} from "@ai-sdlc/security";
import { listPullRequestFiles, publishCheckRun } from "@ai-sdlc/github";
import { JOB_TYPES } from "../config.js";

export interface PullRequestAnalyzeJobData {
  organizationId: string;
  repositoryId: string;
  pullRequestId: string;
  enqueuedAt: string;
}

const DASHBOARD_BASE_URL = process.env["DASHBOARD_BASE_URL"] ?? "";

function buildPassportUrl(passportId: string): string | undefined {
  if (!DASHBOARD_BASE_URL) {
    return undefined;
  }
  return `${DASHBOARD_BASE_URL.replace(/\/$/, "")}/passports/${passportId}`;
}

/**
 * Loads enabled org-defined policies from the database and maps them into
 * the shape @ai-sdlc/policy's evaluatePolicy expects. Returns [] (not an
 * error) if the org has no policies defined — the static baseline rules
 * still apply either way, this is purely additive.
 */
async function loadOrganizationPolicyRules(organizationId: string): Promise<PolicyRule[]> {
  const policies = await prisma.policy.findMany({
    where: { organizationId, enabled: true },
    include: { policyRules: { orderBy: { precedence: "desc" } } },
  });

  return policies.flatMap((policy) =>
    policy.policyRules.map((rule) => ({
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
      action: rule.action,
      requiredApprovals: rule.requiredApprovals.map((type) => ({
        type,
        description: `${type} required by "${policy.name}".`,
      })),
      reason: rule.reason ?? `Matched organization policy "${policy.name}".`,
    })),
  );
}

export async function processPullRequestAnalyze(job: Job<PullRequestAnalyzeJobData>): Promise<void> {
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

  const headSha = pullRequest.headSha ?? undefined;

  // Idempotency guard — never re-run the full pipeline (and re-publish a Check Run) for a commit
  // we've already analyzed. Duplicate webhook deliveries are expected (README §66).
  if (headSha && pullRequest.lastAnalyzedSha === headSha) {
    console.log(`${logPrefix} pr=${pullRequestId} sha=${headSha} already analyzed, skipping`);
    return;
  }

  const installation = repository.githubInstallationId
    ? await prisma.gitHubInstallation.findUnique({ where: { id: repository.githubInstallationId } })
    : null;

  if (!installation) {
    console.warn(`${logPrefix} no GitHub installation for repository ${repositoryId}; file-level analysis and Check Run publishing will be skipped`);
  }

  // ---- Changed files (Phase 6 classification input) ----
  let changedFiles: Array<{ filePath: string; additions: number; deletions: number; status: string }> = [];

  if (installation) {
    try {
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
      }));
    } catch (error) {
      console.error(`${logPrefix} failed to fetch PR files:`, (error as Error).message);
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
  const additions = changedFiles.length > 0 ? classifiedFiles.reduce((s, f) => s + f.additions, 0) : pullRequest.additions;
  const deletions = changedFiles.length > 0 ? classifiedFiles.reduce((s, f) => s + f.deletions, 0) : pullRequest.deletions;
  const changedFileCount = changedFiles.length > 0 ? changedFiles.length : pullRequest.changedFilesCount;

  // ---- AI provenance (persisted during webhook ingestion, Phase 5) ----
  const aiActivity = await prisma.aIActivity.findFirst({
    where: { pullRequestId },
    orderBy: { createdAt: "desc" },
  });

  const aiInvolvement = aiActivity?.involvement ?? "UNKNOWN";
  const aiConfidence = aiActivity?.confidence ?? 0;

  // ---- Risk (Phase 7) ----
  const riskInput: RiskAssessmentInput = {
    repositoryCriticality: (repository.criticality as RiskAssessmentInput["repositoryCriticality"]) ?? "MEDIUM",
    aiInvolvement,
    aiConfidence,
    sensitiveAreas: allSensitiveAreas,
    additions,
    deletions,
    changedFiles: changedFileCount,
    newDependencies: classifiedFiles.filter((f) => f.sensitiveAreas.includes("DEPENDENCIES")).length,
  };

  const risk = evaluateRisk(riskInput);

  await prisma.riskAssessment.create({
    data: {
      organizationId,
      pullRequestId,
      score: risk.score,
      level: risk.level,
      modelVersion: risk.modelVersion,
      factors: risk.factors as unknown as object,
      explanation: risk.explanation,
    },
  });

  // ---- Security evidence (Phase 9/10 — mock providers until real integrations land; never equate
  // NOT_RUN with PASS, README §69) ----
  const providers = [createCodeQLProvider(), createSemgrepProvider(), createSnykProvider(), createSonarProvider()];

  const findings: NormalizedSecurityFinding[] = [];
  const evidence: SecurityEvidence[] = [];

  for (const provider of providers) {
    const result = await provider.analyze(pullRequestId);
    for (const finding of result.findings) {
      findings.push(normalizeSecurityFinding(finding, provider.name));
    }
    evidence.push(...result.evidence);
  }

  await prisma.securityFinding.deleteMany({ where: { pullRequestId } });
  if (findings.length > 0) {
    await prisma.securityFinding.createMany({
      data: findings.map((f) => ({
        organizationId,
        repositoryId,
        pullRequestId,
        provider: f.provider,
        providerFindingId: f.providerFindingId,
        category: f.category,
        severity: f.severity,
        title: f.title,
        description: f.description,
        file: f.file,
        line: f.line,
        ruleId: f.ruleId,
        status: f.status,
        metadata: f.metadata as object | undefined,
      })),
    });
  }

  await prisma.evidence.deleteMany({ where: { pullRequestId } });
  if (evidence.length > 0) {
    await prisma.evidence.createMany({
      data: evidence.map((e) => ({
        organizationId,
        pullRequestId,
        repositoryId,
        type: e.type,
        status: e.result,
        source: e.source,
        metadata: e.metadata as object | undefined,
      })),
    });
  }

  const evidenceSummary = summarizeEvidence(evidence);

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

  const policyDecision = evaluatePolicy(policyInput, await loadOrganizationPolicyRules(organizationId));

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

  // Phase 14: audit logging. Both events are system/automated decisions —
  // no actorId, since no human made this call.
  await recordAuditEvent({
    organizationId,
    eventType: "POLICY_EVALUATED",
    metadata: {
      pullRequestId,
      action: policyDecision.action,
      matchedPolicyIds: policyDecision.matchedPolicies.map((p) => p.policyId),
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

  const existingPassport = await prisma.changePassport.findFirst({ where: { pullRequestId, organizationId } });

  const persistedPassport = existingPassport
    ? await prisma.changePassport.update({
        where: { id: existingPassport.id },
        data: {
          status: passport.status,
          summary: passport.explanation,
          payload: passport as unknown as object,
        },
      })
    : await prisma.changePassport.create({
        data: {
          organizationId,
          pullRequestId,
          status: passport.status,
          summary: passport.explanation,
          payload: passport as unknown as object,
        },
      });

  // ---- GitHub Check Run (Phase 12) ----
  if (installation && headSha) {
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
      await prisma.pullRequest.update({ where: { id: pullRequestId }, data: { lastAnalyzedSha: headSha } });
    }
  } else if (headSha) {
    await prisma.pullRequest.update({ where: { id: pullRequestId }, data: { lastAnalyzedSha: headSha } });
  }

  console.log(
    `${logPrefix} pr=${pullRequestId} risk=${risk.level}(${risk.score}) policy=${policyDecision.action} passport=${persistedPassport.id}`,
  );
}