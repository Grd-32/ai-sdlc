import type { Job } from "bullmq";
import { prisma, recordAuditEvent, type Prisma } from "@ai-sdlc/db";
import {
  listPullRequestReviews,
  listGitHubCodeScanningAlerts,
  listGitHubDependabotAlerts,
  listGitHubSecretScanningAlerts,
  listRepositoryPullRequests,
  getGitHubBranchProtection,
  type GitHubPullRequestReview,
  type GitHubPullRequestSummary,
} from "@ai-sdlc/github";
import { type NormalizedChangeRequest } from "@ai-sdlc/source-control";
import { createGitLabClient } from "../gitlab-connection.js";
import { createBitbucketClient } from "../bitbucket-connection.js";
import { createAzureDevOpsClient } from "../azure-devops-connection.js";
import { getAzureDevOpsFindingEvidenceResult, processPullRequestAnalyze } from "./analyze.js";
import { isDependencyManifestPath } from "@ai-sdlc/risk";
import { normalizeSecurityFinding } from "@ai-sdlc/security";
import { reserveUsage } from "@ai-sdlc/billing";
import { JOB_TYPES } from "../config.js";
import { notifyOrganizationRoles } from "../notification-events.js";

export interface AssessmentJobData {
  assessmentId: string;
  attempt: number;
  enqueuedAt: string;
}

type RepositoryAlertResult = {
  result: "FAIL" | "UNKNOWN" | "NOT_RUN" | "NOT_CONFIGURED";
  alerts: Array<Record<string, unknown>>;
  reason: string | null;
};

const SECRET_VALUE_PATTERNS = [
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bBearer\s+[A-Za-z0-9._~-]{16,}/gi,
  /\b(password|secret|token|api[_-]?key)\s*[:=]\s*["']?[^,\s"']+/gi,
];

export function redactAssessmentText(value: string | null | undefined): string | null {
  if (!value) return value ?? null;
  return SECRET_VALUE_PATTERNS.reduce(
    (text, pattern) => text.replace(pattern, "[REDACTED]"),
    value,
  );
}

function githubAlertCollectionFailure(error: unknown, feature: string): string {
  const message = error instanceof Error ? error.message : "";
  if (/\(403\b/.test(message)) {
    return `The GitHub App does not have read access to ${feature} alerts.`;
  }
  if (/\(404\b/.test(message)) {
    return `${feature} alerts are unavailable; the feature may not be enabled or the GitHub App may lack permission.`;
  }
  return `GitHub ${feature} alerts could not be collected completely.`;
}

type AssessmentProvenanceClassification = "OBSERVED" | "DECLARED" | "INFERRED" | "UNKNOWN";

export function classifyAssessmentProvenance(
  classification: string | undefined,
): AssessmentProvenanceClassification {
  switch (classification) {
    case "OBSERVED":
    case "DECLARED":
    case "INFERRED":
      return classification;
    default:
      return "UNKNOWN";
  }
}

export function summarizeAssessmentProvenance(
  pullRequests: Array<{
    number: number;
    headSha: string | null;
    repository: { owner: string; name: string };
    provenanceSignals: Array<{
      headSha: string | null;
      classification: string;
      verificationStatus: string;
      signalSource: string;
      signalType: string;
      evidenceReference: string | null;
      evidenceAt: Date | null;
      confidence: number | null;
      limitations: string | null;
    }>;
  }>,
): {
  classifications: Record<AssessmentProvenanceClassification, number>;
  coverage: { denominator: number; currentHeadSignals: number; percentage: number | null };
  records: Array<{
    repository: string;
    pullRequest: number;
    headSha: string | null;
    classification: AssessmentProvenanceClassification;
    verificationStatus: string | null;
    signalSource: string | null;
    signalType: string | null;
    evidenceReference: string | null;
    evidenceAt: string | null;
    confidence: number | null;
    limitations: string | null;
  }>;
} {
  const classifications: Record<AssessmentProvenanceClassification, number> = {
    OBSERVED: 0,
    DECLARED: 0,
    INFERRED: 0,
    UNKNOWN: 0,
  };
  let currentHeadSignals = 0;
  const records = pullRequests.map((pullRequest) => {
    const signal = pullRequest.headSha
      ? pullRequest.provenanceSignals.find((candidate) => candidate.headSha === pullRequest.headSha)
      : undefined;
    if (signal) currentHeadSignals += 1;
    const invalidConfidence =
      signal?.confidence !== null &&
      signal?.confidence !== undefined &&
      (!Number.isFinite(signal.confidence) || signal.confidence < 0 || signal.confidence > 1);
    const classification =
      signal && !invalidConfidence
        ? classifyAssessmentProvenance(signal.classification)
        : "UNKNOWN";
    classifications[classification] += 1;
    return {
      repository: `${pullRequest.repository.owner}/${pullRequest.repository.name}`,
      pullRequest: pullRequest.number,
      headSha: signal?.headSha ?? pullRequest.headSha,
      classification,
      verificationStatus: signal?.verificationStatus ?? null,
      signalSource: signal?.signalSource ?? null,
      signalType: signal?.signalType ?? null,
      evidenceReference: signal?.evidenceReference ?? null,
      evidenceAt: signal?.evidenceAt?.toISOString() ?? null,
      confidence: invalidConfidence ? null : (signal?.confidence ?? null),
      limitations: invalidConfidence
        ? "The recorded confidence was outside the valid 0-1 range and was excluded."
        : signal?.limitations ?? null,
    };
  });

  return {
    classifications,
    coverage: {
      denominator: pullRequests.length,
      currentHeadSignals,
      percentage:
        pullRequests.length > 0
          ? Math.round((currentHeadSignals / pullRequests.length) * 100)
          : null,
    },
    records,
  };
}

export function isApprovedOnHead(
  reviews: GitHubPullRequestReview[],
  headSha: string | null,
): boolean {
  return (
    typeof headSha === "string" &&
    headSha.length > 0 &&
    reviews.some((review) => review.state === "APPROVED" && review.commit_id === headSha)
  );
}

export function isPullRequestInAssessmentWindow(
  pullRequest: GitHubPullRequestSummary,
  windowStart: Date,
  windowEnd: Date,
): boolean {
  const createdAt = new Date(pullRequest.created_at);
  const updatedAt = new Date(pullRequest.updated_at);
  return (
    !Number.isNaN(createdAt.getTime()) &&
    !Number.isNaN(updatedAt.getTime()) &&
    updatedAt >= windowStart &&
    updatedAt <= windowEnd &&
    createdAt <= windowEnd
  );
}

export function isReviewInAssessmentWindow(
  review: GitHubPullRequestReview,
  windowStart: Date,
  windowEnd: Date,
): boolean {
  if (!review.submitted_at) return false;
  const submittedAt = new Date(review.submitted_at);
  return (
    !Number.isNaN(submittedAt.getTime()) && submittedAt >= windowStart && submittedAt <= windowEnd
  );
}

function projectForAzureRepository(owner: string): string {
  return owner.split("/").slice(1).join("/");
}

export function getHighestPullRequestRiskScore(scores: Array<{ score: number }>): number | null {
  return scores.length ? Math.max(...scores.map((risk) => risk.score)) : null;
}

type AssessmentCoverageStatus = "ASSESSED" | "PARTIAL" | "NOT_RUN" | "NOT_CONFIGURED";

interface AssessmentCoverageItem {
  [key: string]: Prisma.InputJsonValue;
  area: string;
  status: AssessmentCoverageStatus;
  scope: string;
  detail: string;
}

export function buildAssessmentReadout(input: {
  pullRequestsAnalysed: number;
  findingCount: number;
  coverage: AssessmentCoverageItem[];
}): {
  outcome: "FINDINGS_DETECTED" | "NO_RECENT_PULL_REQUESTS" | "LIMITED_COVERAGE" | "ASSESSED";
  headline: string;
  conclusion: string;
} {
  if (input.findingCount > 0) {
    return {
      outcome: "FINDINGS_DETECTED",
      headline: `${input.findingCount} security finding${input.findingCount === 1 ? "" : "s"} detected in the assessed scope.`,
      conclusion:
        input.pullRequestsAnalysed === 0
          ? "Review the repository-level findings and their evidence. No recent pull requests were available, so no PR-level risk, policy, review, or AI-provenance conclusion can be drawn."
          : "Review the findings and their evidence. This report covers only the repositories, pull requests, and provider data listed below.",
    };
  }
  if (input.pullRequestsAnalysed === 0) {
    return {
      outcome: "NO_RECENT_PULL_REQUESTS",
      headline: "No pull requests with activity in this period were available to assess.",
      conclusion:
        "No pull-request risk, policy, review, or AI-provenance conclusion can be drawn. Empty findings do not mean the repository is free of risk.",
    };
  }
  if (
    input.coverage.some((item) => ["PARTIAL", "NOT_RUN", "NOT_CONFIGURED"].includes(item.status))
  ) {
    return {
      outcome: "LIMITED_COVERAGE",
      headline: "No findings were returned, but assessment coverage is incomplete.",
      conclusion:
        "Treat this as results for the evidence actually collected, not as confirmation that the repository is secure.",
    };
  }
  return {
    outcome: "ASSESSED",
    headline: "No findings were returned by the checks completed in this assessment.",
    conclusion:
      "This result applies only to the assessed scope and configured checks; it is not a guarantee that no risk exists.",
  };
}

export function buildAssessmentRecommendedActions(input: {
  pullRequestsAnalysed: number;
  coverage: AssessmentCoverageItem[];
  findings: Array<{ id: unknown; severity: string; title: string; provider: string }>;
}): Array<{ priority: string; action: string; evidenceId: unknown }> {
  const actions: Array<{ priority: string; action: string; evidenceId: unknown }> = input.findings
    .filter((finding) => ["CRITICAL", "HIGH"].includes(finding.severity))
    .map((finding) => ({
      priority: finding.severity,
      action: `Review ${finding.provider} finding ${typeof finding.id === "string" || typeof finding.id === "number" ? finding.id : "unknown"}: ${finding.title} (${finding.severity}).`,
      evidenceId: finding.id,
    }));

  if (input.pullRequestsAnalysed === 0) {
    actions.push({
      priority: "NEXT_STEP",
      action:
        "Open or update a pull request in a selected repository, then run a new assessment to get pull-request risk, policy, review, and provenance results.",
      evidenceId: null,
    });
  }

  for (const item of input.coverage) {
    if (item.status === "ASSESSED" || item.area === "Pull-request activity") continue;
    const action =
      item.area === "Secret scanning"
        ? "Enable the provider's secret scanning and grant the connected app read access to its alerts, then rerun the assessment."
        : item.area === "GitHub Code Scanning alerts"
          ? "Enable Code Scanning for the repository and grant the GitHub App Code scanning alerts: read permission, then approve the updated installation permissions."
          : item.area === "GitHub Dependabot alerts"
            ? "Enable Dependabot alerts for the repository and grant the GitHub App Dependabot alerts: read permission, then approve the updated installation permissions."
            : item.area === "Branch protection"
              ? "Verify protection on each repository's default branch in the source-control provider and grant read access if the configuration is not visible."
              : item.area === "Dependency vulnerability scanning"
                ? "Run a dependency vulnerability scan with a configured scanner; dependency manifest changes in this report are not a vulnerability scan."
                : item.area === "AI provenance"
                  ? "Record provenance evidence for pull requests when available; unknown provenance is not evidence that a change was or was not AI-generated."
                  : item.area === "Pull-request policy"
                    ? "Review organization policy configuration and ensure each assessed pull request has a recorded policy decision."
                    : item.area === "Pull-request security checks"
                      ? "Configure and run supported security checks for the pull-request head, then rerun the assessment."
                      : item.area === "Pull-request activity"
                        ? "Open or update a pull request in a selected repository during the assessment window to enable pull-request analysis."
                        : item.area === "Review coverage"
                          ? "Require and record reviewer approvals on the current pull-request head."
                          : `Improve coverage for ${item.area.toLowerCase()}.`;
    if (!actions.some((entry) => entry.action === action)) {
      actions.push({
        priority: "MEDIUM",
        action,
        evidenceId: null,
      });
    }
  }
  return actions;
}

function currentAssessmentValue(pullRequest: GitHubPullRequestSummary) {
  return {
    externalId: String(pullRequest.id),
    number: pullRequest.number,
    title: pullRequest.title,
    state: pullRequest.merged_at ? "MERGED" : pullRequest.state.toUpperCase(),
    authorLogin: pullRequest.user?.login ?? null,
    sourceBranch: pullRequest.head?.ref ?? null,
    targetBranch: pullRequest.base?.ref ?? null,
    headSha: pullRequest.head?.sha ?? null,
    additions: pullRequest.additions,
    deletions: pullRequest.deletions,
    changedFilesCount: pullRequest.changed_files,
    createdAt: new Date(pullRequest.created_at),
    updatedAt: new Date(pullRequest.updated_at),
    mergedAt: pullRequest.merged_at ? new Date(pullRequest.merged_at) : null,
  };
}

export function toAssessmentPullRequest(
  request: NormalizedChangeRequest,
): GitHubPullRequestSummary {
  const id = request.provider === "AZURE_DEVOPS" ? request.number : Number(request.externalId);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new Error(`${request.provider} returned a change request with an invalid external ID.`);
  }
  return {
    id,
    number: request.number,
    title: request.title,
    state: request.state.toLowerCase(),
    created_at: request.createdAt,
    updated_at: request.updatedAt,
    merged_at: request.mergedAt,
    user: request.author ? { login: request.author } : null,
    head:
      request.headSha && request.sourceBranch
        ? { sha: request.headSha, ref: request.sourceBranch }
        : null,
    base: request.targetBranch ? { ref: request.targetBranch } : null,
    additions: request.additions ?? 0,
    deletions: request.deletions ?? 0,
    changed_files: request.changedFilesCount ?? 0,
  };
}

export async function processAssessment(job: Job<AssessmentJobData>): Promise<void> {
  const { assessmentId, attempt } = job.data;
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    include: {
      repositories: {
        include: {
          repository: { include: { installation: true, sourceControlConnection: true } },
        },
      },
    },
  });

  if (!assessment) {
    throw new Error(`Assessment ${assessmentId} does not exist`);
  }
  if (assessment.status === "CANCELLED") {
    return;
  }
  if (!["QUEUED", "RUNNING"].includes(assessment.status)) {
    throw new Error(`Assessment ${assessmentId} cannot run from ${assessment.status}`);
  }

  const started = await prisma.assessment.updateMany({
    where: { id: assessmentId, status: { in: ["QUEUED", "RUNNING"] } },
    data: {
      status: "RUNNING",
      attempt,
      startedAt: assessment.startedAt ?? new Date(),
      errorCode: null,
      errorMessage: null,
    },
  });
  if (started.count !== 1) return;

  const selectedRepositories = assessment.repositories.map((entry) => entry.repository);
  const collected: Array<{
    repositoryId: string;
    pullRequest: GitHubPullRequestSummary;
    reviews: GitHubPullRequestReview[];
  }> = [];
  const repositorySecurityContext: Array<{
    repositoryId: string;
    provider: string;
    fullName: string;
    secretScanning:
      | { result: "PASS" | "FAIL" | "UNKNOWN"; alerts: Array<Record<string, unknown>> }
      | { result: "NOT_RUN"; reason: string };
    codeScanning: RepositoryAlertResult;
    dependabot: RepositoryAlertResult;
    securityFindings: Array<Record<string, unknown>>;
    securityAlertCoverage: {
      result: "FAIL" | "UNKNOWN" | "NOT_RUN";
      complete: boolean;
      findingCount: number;
      reason: string | null;
    };
    branchProtection: Record<string, unknown>;
    changeRequestsComplete: boolean;
  }> = [];

  try {
    for (const repository of selectedRepositories) {
      const liveAssessment = await prisma.assessment.findUnique({
        where: { id: assessmentId },
        select: { status: true },
      });
      if (liveAssessment?.status === "CANCELLED") return;
      const installation = repository.installation;
      if (repository.organizationId !== assessment.organizationId || !repository.enabled) {
        throw new Error("A selected repository is no longer available to this organization.");
      }
      if (
        repository.provider === "GITHUB" &&
        (!installation?.active || installation.organizationId !== assessment.organizationId)
      ) {
        throw new Error("A selected repository is no longer available to this organization.");
      }
      if (repository.provider === "GITHUB" && !installation) {
        throw new Error("A selected repository is no longer available to this organization.");
      }
      if (!["GITHUB", "GITLAB", "BITBUCKET", "AZURE_DEVOPS"].includes(repository.provider)) {
        throw new Error(`Repository provider ${repository.provider} is not supported.`);
      }
      const gitLabConnection = repository.sourceControlConnection;
      if (
        repository.provider === "GITLAB" &&
        (!gitLabConnection?.active ||
          gitLabConnection.organizationId !== assessment.organizationId ||
          gitLabConnection.provider !== "GITLAB")
      ) {
        throw new Error("The GitLab connection for a selected repository is no longer available.");
      }
      const bitbucketConnection = repository.sourceControlConnection;
      if (
        repository.provider === "BITBUCKET" &&
        (!bitbucketConnection?.active ||
          bitbucketConnection.organizationId !== assessment.organizationId ||
          bitbucketConnection.provider !== "BITBUCKET")
      ) {
        throw new Error(
          "The Bitbucket connection for a selected repository is no longer available.",
        );
      }
      if (
        repository.provider === "AZURE_DEVOPS" &&
        (!repository.sourceControlConnection?.active ||
          repository.sourceControlConnection.organizationId !== assessment.organizationId ||
          repository.sourceControlConnection.provider !== "AZURE_DEVOPS")
      ) {
        throw new Error(
          "The Azure DevOps connection for a selected repository is no longer available.",
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
        repository.provider === "AZURE_DEVOPS" && repository.sourceControlConnection
          ? await createAzureDevOpsClient(repository.sourceControlConnection)
          : null;
      let changeRequestsComplete = true;
      let pullRequests: GitHubPullRequestSummary[];
      if (repository.provider === "GITHUB" && installation) {
        pullRequests = await listRepositoryPullRequests(
          installation.githubInstallationId,
          repository.owner,
          repository.name,
        );
      } else if (repository.provider === "GITLAB") {
        if (!gitLabClient || !repository.externalId) {
          throw new Error("The selected GitLab project is missing its provider connection or ID.");
        }
        const collection = await gitLabClient.listMergeRequests(repository.externalId, {
          start: assessment.windowStart,
          end: assessment.windowEnd,
        });
        changeRequestsComplete = collection.complete;
        pullRequests = collection.items.map(toAssessmentPullRequest);
      } else if (repository.provider === "BITBUCKET") {
        if (!bitbucketClient) {
          throw new Error(
            "The selected Bitbucket repository is missing its active provider connection.",
          );
        }
        const collection = await bitbucketClient.listPullRequests(
          repository.owner,
          repository.name,
          {
            start: assessment.windowStart,
            end: assessment.windowEnd,
          },
        );
        changeRequestsComplete = collection.complete;
        pullRequests = collection.items.map(toAssessmentPullRequest);
      } else if (repository.provider === "AZURE_DEVOPS") {
        if (!azureDevOpsClient || !repository.externalId) {
          throw new Error(
            "The selected Azure DevOps repository is missing its active provider connection or ID.",
          );
        }
        const project = projectForAzureRepository(repository.owner);
        if (!project) {
          throw new Error("The selected Azure DevOps repository is missing its project name.");
        }
        const collection = await azureDevOpsClient.listPullRequests(
          project,
          repository.externalId,
          { start: assessment.windowStart, end: assessment.windowEnd },
        );
        changeRequestsComplete = collection.complete;
        pullRequests = collection.items.map(toAssessmentPullRequest);
      } else {
        throw new Error("The selected repository provider is unavailable for assessment.");
      }
      let secretScanning: (typeof repositorySecurityContext)[number]["secretScanning"];
      let securityFindings: Array<Record<string, unknown>> = [];
      let securityAlertCoverage: (typeof repositorySecurityContext)[number]["securityAlertCoverage"] =
        {
          result: "NOT_RUN",
          complete: false,
          findingCount: 0,
          reason: "Native security alerts were not collected for this provider.",
        };
      if (repository.provider === "GITLAB") {
        secretScanning = {
          result: "NOT_RUN",
          reason:
            "No current-head GitLab secret-detection report was collected from an analyzed merge-request pipeline.",
        };
      } else if (repository.provider === "BITBUCKET") {
        secretScanning = {
          result: "NOT_RUN",
          reason:
            "Bitbucket Cloud secret-scanning findings are not integrated with this assessment.",
        };
      } else if (repository.provider === "AZURE_DEVOPS") {
        const connection = repository.sourceControlConnection;
        const hasAdvancedSecurityScope =
          connection?.scopes.some((scope) => scope.toLowerCase() === "vso.advsec") ?? false;
        if (!azureDevOpsClient || !repository.externalId || !hasAdvancedSecurityScope) {
          const reason = hasAdvancedSecurityScope
            ? "The Azure DevOps Advanced Security connection or repository is unavailable."
            : "The Azure DevOps connection lacks vso.advsec; an organization administrator must reconnect and consent to the Advanced Security read permission.";
          secretScanning = { result: "NOT_RUN", reason };
          securityAlertCoverage = {
            result: "NOT_RUN",
            complete: false,
            findingCount: 0,
            reason,
          };
        } else {
          try {
            const alerts = await azureDevOpsClient.listSecurityAlerts(
              projectForAzureRepository(repository.owner),
              repository.externalId,
            );
            securityFindings = alerts.items.map((alert) => {
              const category =
                alert.type === "secret"
                  ? "SECRET"
                  : alert.type === "dependency"
                    ? "SCA"
                    : alert.type === "code"
                      ? "SAST"
                      : "OTHER";
              const finding = normalizeSecurityFinding(
                {
                  id: alert.id,
                  category,
                  severity: alert.severity,
                  title: alert.title,
                  status: alert.status,
                },
                "Azure DevOps Advanced Security",
              );
              return {
                id: finding.providerFindingId,
                category: finding.category,
                severity: finding.severity,
                title:
                  finding.category === "SECRET"
                    ? "Secret detection finding"
                    : redactAssessmentText(finding.title),
                status: finding.status,
                firstSeenAt: alert.firstSeenAt,
              };
            });
            const secretAlerts = securityFindings
              .filter((finding) => finding["category"] === "SECRET")
              .map((finding) => ({
                id: finding["id"],
                type: "Secret detected",
                severity: finding["severity"],
                status: finding["status"],
                firstSeenAt: finding["firstSeenAt"],
              }));
            const hasSecretAlerts = secretAlerts.length > 0;
            const noAlertsLimitation =
              "No active secret alerts were returned; this does not prove that Azure DevOps secret scanning is enabled or complete.";
            secretScanning = hasSecretAlerts
              ? { result: "FAIL", alerts: secretAlerts }
              : { result: "UNKNOWN", alerts: [] };
            securityAlertCoverage = {
              result: getAzureDevOpsFindingEvidenceResult(securityFindings.length),
              complete: alerts.complete,
              findingCount: securityFindings.length,
              reason:
                securityFindings.length === 0
                  ? noAlertsLimitation
                  : alerts.complete
                    ? null
                    : "The provider alert collection reached its pagination safety limit.",
            };
          } catch (error) {
            const reason =
              error instanceof Error
                ? error.message
                : "Azure DevOps Advanced Security alerts are unavailable.";
            secretScanning = { result: "NOT_RUN", reason };
            securityAlertCoverage = {
              result: "NOT_RUN",
              complete: false,
              findingCount: 0,
              reason,
            };
          }
        }
      } else if (installation) {
        try {
          const alerts = await listGitHubSecretScanningAlerts(
            installation.githubInstallationId,
            repository.owner,
            repository.name,
          );
          secretScanning = {
            result: alerts.length > 0 ? "FAIL" : "PASS",
            alerts: alerts.map((alert) => ({
              id: alert.number,
              type: alert.secret_type_display_name || alert.secret_type,
              status: alert.state,
              createdAt: alert.created_at,
              updatedAt: alert.updated_at,
              resolution: alert.resolution,
              evidenceUrl: alert.html_url,
            })),
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : "";
          secretScanning = {
            result: "NOT_RUN",
            reason: /\((403|404)\b/.test(message)
              ? "GitHub secret-scanning alerts are unavailable with the installed App permissions or repository configuration."
              : "GitHub secret-scanning could not return a complete result.",
          };
          console.warn(
            `[${JOB_TYPES.ASSESSMENT_RUN}] secret-scanning unavailable for ${repository.owner}/${repository.name}`,
          );
        }
      } else {
        throw new Error("Active GitHub installation unavailable during assessment.");
      }

      let codeScanning: RepositoryAlertResult = {
        result: "NOT_CONFIGURED",
        alerts: [],
        reason:
          "Repository-wide GitHub Code Scanning alerts are only available for GitHub repositories.",
      };
      let dependabot: RepositoryAlertResult = {
        result: "NOT_CONFIGURED",
        alerts: [],
        reason: "GitHub Dependabot alerts are only available for GitHub repositories.",
      };
      if (repository.provider === "GITHUB" && installation) {
        try {
          const alerts = await listGitHubCodeScanningAlerts(
            installation.githubInstallationId,
            repository.owner,
            repository.name,
          );
          codeScanning = {
            result: alerts.length > 0 ? "FAIL" : "UNKNOWN",
            alerts: alerts.map((alert) => ({
              id: alert.number,
              title: redactAssessmentText(alert.title),
              severity: alert.severity,
              file: alert.file,
              line: alert.line,
              status: alert.state,
              evidenceUrl: alert.html_url,
            })),
            reason:
              alerts.length === 0
                ? "No open alerts were returned; this does not prove that Code Scanning is enabled or has completed successfully."
                : null,
          };
          securityFindings.push(
            ...alerts.map((alert) => {
              const finding = normalizeSecurityFinding(
                {
                  id: alert.number,
                  category: "SAST",
                  severity: alert.severity ?? "UNKNOWN",
                  title: redactAssessmentText(alert.title),
                  status: alert.state,
                  file: alert.file,
                  line: alert.line,
                },
                "GitHub Code Scanning",
              );
              return {
                id: finding.providerFindingId,
                category: finding.category,
                severity: finding.severity,
                title: redactAssessmentText(finding.title),
                status: finding.status,
                file: finding.file,
                line: finding.line,
                evidenceUrl: alert.html_url,
                provider: "GitHub Code Scanning",
              };
            }),
          );
        } catch (error) {
          const reason = githubAlertCollectionFailure(error, "Code Scanning");
          codeScanning = { result: "NOT_RUN", alerts: [], reason };
          console.warn(
            `[${JOB_TYPES.ASSESSMENT_RUN}] Code Scanning alerts unavailable for ${repository.owner}/${repository.name}: ${reason}`,
          );
        }
        try {
          const alerts = await listGitHubDependabotAlerts(
            installation.githubInstallationId,
            repository.owner,
            repository.name,
          );
          dependabot = {
            result: alerts.length > 0 ? "FAIL" : "UNKNOWN",
            alerts: alerts.map((alert) => ({
              id: alert.number,
              packageName: alert.packageName,
              manifestPath: alert.manifestPath,
              title: redactAssessmentText(alert.summary),
              severity: alert.severity,
              status: alert.state,
              createdAt: alert.createdAt,
              evidenceUrl: alert.html_url,
            })),
            reason:
              alerts.length === 0
                ? "No open alerts were returned; this does not prove Dependabot alerting is enabled or all manifests are covered."
                : null,
          };
          securityFindings.push(
            ...alerts.map((alert) => {
              const title = `${alert.packageName}: ${redactAssessmentText(alert.summary) ?? "Dependency vulnerability"}`;
              const finding = normalizeSecurityFinding(
                {
                  id: alert.number,
                  category: "SCA",
                  severity: alert.severity ?? "UNKNOWN",
                  title,
                  status: alert.state,
                  file: alert.manifestPath,
                },
                "GitHub Dependabot",
              );
              return {
                id: finding.providerFindingId,
                category: finding.category,
                severity: finding.severity,
                title: redactAssessmentText(finding.title),
                status: finding.status,
                file: finding.file,
                firstSeenAt: alert.createdAt,
                evidenceUrl: alert.html_url,
                provider: "GitHub Dependabot",
              };
            }),
          );
        } catch (error) {
          const reason = githubAlertCollectionFailure(error, "Dependabot");
          dependabot = { result: "NOT_RUN", alerts: [], reason };
          console.warn(
            `[${JOB_TYPES.ASSESSMENT_RUN}] Dependabot alerts unavailable for ${repository.owner}/${repository.name}: ${reason}`,
          );
        }
      }

      let branchProtection: Record<string, unknown>;
      if (repository.provider === "GITLAB") {
        if (!gitLabClient || !repository.externalId) {
          branchProtection = {
            status: "NOT_RUN",
            reason: "The GitLab project or active provider connection is unavailable.",
          };
        } else if (!repository.defaultBranch) {
          branchProtection = {
            status: "UNKNOWN",
            reason: "The connected GitLab project has no recorded default branch.",
          };
        } else {
          try {
            const branches = await gitLabClient.listProtectedBranches(repository.externalId);
            const protectedDefaultBranch = branches.items.find(
              (branch) => branch.name === repository.defaultBranch,
            );
            const wildcardMayApply =
              !protectedDefaultBranch && branches.items.some((branch) => /[*?]/.test(branch.name));
            const status =
              !branches.complete || wildcardMayApply
                ? "UNKNOWN"
                : !protectedDefaultBranch || protectedDefaultBranch.allowForcePush
                  ? "FAIL"
                  : "PASS";
            branchProtection = {
              status,
              branch: repository.defaultBranch,
              protected: Boolean(protectedDefaultBranch),
              allowForcePush: protectedDefaultBranch?.allowForcePush ?? null,
              codeOwnerApprovalRequired: protectedDefaultBranch?.codeOwnerApprovalRequired ?? null,
              pushAccessLevels: protectedDefaultBranch?.pushAccessLevels ?? [],
              mergeAccessLevels: protectedDefaultBranch?.mergeAccessLevels ?? [],
              wildcardRuleMayApply: wildcardMayApply,
              complete: branches.complete,
              limitation:
                "Only exact default-branch rules are evaluated; wildcard inheritance and project-level approval rules are not inferred.",
            };
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : "GitLab protected-branch settings unavailable";
            branchProtection = { status: "NOT_RUN", reason: message };
          }
        }
      } else if (repository.provider === "BITBUCKET") {
        if (!bitbucketClient) {
          branchProtection = {
            status: "NOT_RUN",
            reason: "The Bitbucket workspace or active provider connection is unavailable.",
          };
        } else {
          try {
            const restrictions = await bitbucketClient.listBranchRestrictions(
              repository.owner,
              repository.name,
            );
            branchProtection = {
              status: "UNKNOWN",
              branch: repository.defaultBranch,
              restrictions: restrictions.items,
              complete: restrictions.complete,
              limitation:
                "Bitbucket branch-restriction settings are collected, but this integration does not validate rule semantics, wildcard resolution, or effective enforcement. Configuration presence is not reported as verified branch protection.",
            };
          } catch (error) {
            branchProtection = {
              status: "NOT_RUN",
              reason:
                error instanceof Error
                  ? error.message
                  : "Bitbucket branch restrictions unavailable.",
            };
          }
        }
      } else if (repository.provider === "AZURE_DEVOPS" && azureDevOpsClient) {
        if (!repository.defaultBranch) {
          branchProtection = {
            status: "UNKNOWN",
            reason: "The connected Azure DevOps repository has no recorded default branch.",
          };
        } else {
          try {
            const policies = await azureDevOpsClient.listBranchPolicies(
              projectForAzureRepository(repository.owner),
            );
            const defaultRef = `refs/heads/${repository.defaultBranch}`;
            const exactPolicies = policies.items.filter(
              (policy) => policy.branchRef === defaultRef,
            );
            branchProtection = {
              status: "UNKNOWN",
              branch: repository.defaultBranch,
              exactBlockingPolicies: exactPolicies.filter(
                (policy) => policy.enabled && policy.blocking,
              ),
              complete: policies.complete,
              limitation:
                "Policy configurations are collected for exact branch scopes, but this integration does not validate their semantics, inherited scopes, or enforcement outcome; configuration presence is not reported as effective protection.",
            };
          } catch (error) {
            branchProtection = {
              status: "NOT_RUN",
              reason:
                error instanceof Error
                  ? error.message
                  : "Azure DevOps branch policies unavailable.",
            };
          }
        }
      } else if (!installation) {
        throw new Error("Active GitHub installation unavailable during assessment.");
      } else if (!repository.defaultBranch) {
        branchProtection = {
          status: "UNKNOWN",
          reason: "The connected repository has no recorded default branch.",
        };
      } else {
        try {
          branchProtection = await getGitHubBranchProtection(
            installation.githubInstallationId,
            repository.owner,
            repository.name,
            repository.defaultBranch,
          );
        } catch {
          branchProtection = {
            status: "UNKNOWN",
            reason: "GitHub did not return branch-protection settings.",
          };
        }
      }
      repositorySecurityContext.push({
        repositoryId: repository.id,
        provider: repository.provider,
        fullName: `${repository.owner}/${repository.name}`,
        secretScanning,
        codeScanning,
        dependabot,
        securityFindings,
        securityAlertCoverage,
        branchProtection,
        changeRequestsComplete,
      });

      for (const pullRequest of pullRequests) {
        const currentStatus = await prisma.assessment.findUnique({
          where: { id: assessmentId },
          select: { status: true },
        });
        if (currentStatus?.status === "CANCELLED") return;
        if (
          !isPullRequestInAssessmentWindow(
            pullRequest,
            assessment.windowStart,
            assessment.windowEnd,
          )
        ) {
          continue;
        }
        const reviews =
          repository.provider === "GITHUB" && installation
            ? await listPullRequestReviews(
                installation.githubInstallationId,
                repository.owner,
                repository.name,
                pullRequest.number,
              )
            : repository.provider === "BITBUCKET" &&
                repository.sourceControlConnection?.active &&
                repository.sourceControlConnection.provider === "BITBUCKET"
              ? (
                  await (
                    await createBitbucketClient(repository.sourceControlConnection)
                  ).listPullRequestReviews(repository.owner, repository.name, pullRequest.number)
                ).items.map((review, index) => ({
                  id: index,
                  user: review.actor ? { login: review.actor } : null,
                  state: review.state,
                  submitted_at: review.submittedAt,
                  commit_id: review.commitSha,
                }))
              : repository.provider === "AZURE_DEVOPS" &&
                  repository.sourceControlConnection?.active &&
                  repository.sourceControlConnection.provider === "AZURE_DEVOPS" &&
                  azureDevOpsClient
                ? (
                    await azureDevOpsClient.listPullRequestReviews(
                      projectForAzureRepository(repository.owner),
                      repository.externalId ?? "",
                      pullRequest.number,
                    )
                  ).items.map((review, index) => ({
                    id: index,
                    user: review.actor ? { login: review.actor } : null,
                    state: review.state,
                    submitted_at: review.submittedAt,
                    commit_id: review.commitSha,
                  }))
                : [];
        collected.push({
          repositoryId: repository.id,
          pullRequest,
          reviews: reviews.filter((review) =>
            isReviewInAssessmentWindow(review, assessment.windowStart, assessment.windowEnd),
          ),
        });
      }
    }

    await prisma.assessment.update({
      where: { id: assessmentId },
      data: { totalPullRequests: collected.length },
    });

    const pullRequestIds: string[] = [];
    let processedPullRequests = 0;
    for (const item of collected) {
      const liveAssessment = await prisma.assessment.findUnique({
        where: { id: assessmentId },
        select: { status: true },
      });
      if (liveAssessment?.status === "CANCELLED") {
        return;
      }
      const repository = selectedRepositories.find(
        (candidate) => candidate.id === item.repositoryId,
      );
      if (!repository) {
        throw new Error("Assessment repository scope changed during processing.");
      }

      const pullRequest = await prisma.pullRequest.upsert({
        where: {
          repositoryId_provider_externalId: {
            repositoryId: repository.id,
            provider: repository.provider,
            externalId: String(item.pullRequest.id),
          },
        },
        update: currentAssessmentValue(item.pullRequest),
        create: {
          organizationId: assessment.organizationId,
          repositoryId: repository.id,
          provider: repository.provider,
          ...currentAssessmentValue(item.pullRequest),
        },
        select: { id: true },
      });
      pullRequestIds.push(pullRequest.id);

      await processPullRequestAnalyze({
        data: {
          organizationId: assessment.organizationId,
          repositoryId: repository.id,
          pullRequestId: pullRequest.id,
          enqueuedAt: new Date().toISOString(),
          assessmentMode: true,
        },
      });

      processedPullRequests += 1;
      const progress =
        collected.length === 0
          ? 95
          : Math.min(95, Math.floor((processedPullRequests / collected.length) * 95));
      await prisma.assessment.update({
        where: { id: assessmentId },
        data: { processedPullRequests, progress },
      });
    }

    const records = pullRequestIds.length
      ? await prisma.pullRequest.findMany({
          where: { organizationId: assessment.organizationId, id: { in: pullRequestIds } },
          include: {
            repository: { select: { id: true, owner: true, name: true } },
            riskAssessments: { orderBy: { createdAt: "desc" }, take: 1 },
            policyDecisions: { orderBy: { createdAt: "desc" }, take: 1 },
            provenanceSignals: {
              where: { evidenceAt: { lte: assessment.windowEnd } },
              orderBy: { evidenceAt: "desc" },
              take: 1,
            },
            findings: true,
            evidence: true,
            codeChanges: true,
          },
        })
      : [];

    for (const repositoryContext of repositorySecurityContext) {
      const repositoryRecords = records.filter(
        (record) => record.repository.id === repositoryContext.repositoryId,
      );
      if (
        selectedRepositories.find((repository) => repository.id === repositoryContext.repositoryId)
          ?.provider !== "GITLAB"
      ) {
        continue;
      }

      const perChangeScanResults = repositoryRecords.map((record) => {
        const statuses = record.evidence
          .filter(
            (item) => item.type === "SECRET_SCAN" && item.source === "GitLab Secret Detection",
          )
          .map((item) => item.status);
        if (statuses.includes("FAIL")) return "FAIL";
        if (statuses.includes("UNKNOWN") || statuses.includes("NOT_RUN") || statuses.length === 0) {
          return statuses.length === 0 ? "NOT_RUN" : "UNKNOWN";
        }
        return statuses.every((status) => status === "PASS") ? "PASS" : "UNKNOWN";
      });
      const scanResult = perChangeScanResults.includes("FAIL")
        ? "FAIL"
        : perChangeScanResults.length === 0 ||
            perChangeScanResults.every((status) => status === "NOT_RUN")
          ? "NOT_RUN"
          : perChangeScanResults.some((status) => status !== "PASS")
            ? "UNKNOWN"
            : "PASS";
      const secretFindings = repositoryRecords.flatMap((record) =>
        record.findings
          .filter((finding) => finding.category === "SECRET")
          .map((finding) => ({
            id: finding.id,
            type: "Secret detected",
            status: finding.status,
            file: finding.file,
            line: finding.line,
          })),
      );
      repositoryContext.secretScanning =
        scanResult === "NOT_RUN"
          ? {
              result: "NOT_RUN",
              reason:
                "GitLab Secret Detection was not available for one or more current-head pipelines; scan coverage is not represented as clean.",
            }
          : { result: scanResult, alerts: secretFindings };
    }

    const severityCounts: Record<string, number> = {};
    const findingRows = records.flatMap((pullRequest) =>
      pullRequest.findings.map((finding) => {
        return {
          id: finding.id,
          repository: `${pullRequest.repository.owner}/${pullRequest.repository.name}`,
          pullRequest: pullRequest.number,
          severity: finding.severity,
          category: finding.category,
          title:
            finding.category === "SECRET"
              ? "Secret detection finding"
              : redactAssessmentText(finding.title),
          file: finding.file,
          line: finding.line,
          provider: finding.provider,
          status: finding.status,
        };
      }),
    );
    const repositoryFindingRows = repositorySecurityContext.flatMap((repository) => [
      ...repository.securityFindings.map((finding) => {
        const severity = typeof finding["severity"] === "string" ? finding["severity"] : "UNKNOWN";
        return {
          id: finding["id"],
          repository: repository.fullName,
          pullRequest: null,
          severity,
          category: finding["category"],
          title: finding["title"],
          status: finding["status"],
          file: finding["file"],
          line: finding["line"],
          firstSeenAt: finding["firstSeenAt"],
          evidenceUrl: finding["evidenceUrl"],
          provider:
            typeof finding["provider"] === "string"
              ? finding["provider"]
              : "Azure DevOps Advanced Security",
        };
      }),
      ...(repository.secretScanning.result === "FAIL"
        ? repository.secretScanning.alerts.map((alert) => {
            const severity = "UNRATED";
            return {
              id: alert["id"],
              repository: repository.fullName,
              pullRequest: null,
              severity,
              category: "SECRET",
              title: "Secret detection finding",
              status: alert["status"],
              file: alert["file"],
              line: alert["line"],
              firstSeenAt: alert["createdAt"],
              evidenceUrl: alert["evidenceUrl"],
              provider: `${repository.provider} Secret Scanning`,
            };
          })
        : []),
    ]);
    const pullRequestFindingKeys = new Set(
      findingRows.flatMap((finding) => {
        const id = finding.id;
        const category = typeof finding.category === "string" ? finding.category : "UNKNOWN";
        return typeof id === "string" || typeof id === "number"
          ? [`${finding.repository}|${category}|${id}`]
          : [];
      }),
    );
    const allFindingRows = [
      ...findingRows,
      ...repositoryFindingRows.filter((finding) => {
        const id = finding.id;
        if (typeof id !== "string" && typeof id !== "number") return true;
        const category = typeof finding.category === "string" ? finding.category : "UNKNOWN";
        const key = `${finding.repository}|${category}|${id}`;
        return !pullRequestFindingKeys.has(key);
      }),
    ];
    for (const finding of allFindingRows) {
      const severity = typeof finding.severity === "string" ? finding.severity : "UNKNOWN";
      severityCounts[severity] = (severityCounts[severity] ?? 0) + 1;
    }

    const allEvidence = [
      ...records.flatMap((pullRequest) =>
        pullRequest.evidence.map((evidence) => ({
          id: evidence.id,
          pullRequest: pullRequest.number,
          repository: `${pullRequest.repository.owner}/${pullRequest.repository.name}`,
          type: evidence.type,
          source: evidence.source,
          status: evidence.status,
          reason: redactAssessmentText(
            typeof evidence.metadata === "object" &&
              evidence.metadata !== null &&
              "reason" in evidence.metadata &&
              typeof evidence.metadata["reason"] === "string"
              ? evidence.metadata["reason"]
              : evidence.details,
          ),
        })),
      ),
      ...repositorySecurityContext.flatMap((repository) => [
        ...(repository.provider === "AZURE_DEVOPS"
          ? [
              {
                id: null,
                pullRequest: null,
                repository: repository.fullName,
                type: "SECURITY_FINDINGS",
                source: "Azure DevOps Advanced Security active alerts",
                status: repository.securityAlertCoverage.result,
                reason: repository.securityAlertCoverage.reason,
                findingCount: repository.securityAlertCoverage.findingCount,
                complete: repository.securityAlertCoverage.complete,
              },
            ]
          : []),
        ...(repository.provider === "GITHUB"
          ? [
              {
                id: null,
                pullRequest: null,
                repository: repository.fullName,
                type: "SAST",
                source: "GitHub Code Scanning alerts",
                status: repository.codeScanning.result,
                reason: repository.codeScanning.reason,
                findingCount: repository.codeScanning.alerts.length,
              },
              {
                id: null,
                pullRequest: null,
                repository: repository.fullName,
                type: "SCA",
                source: "GitHub Dependabot alerts",
                status: repository.dependabot.result,
                reason: repository.dependabot.reason,
                findingCount: repository.dependabot.alerts.length,
              },
            ]
          : []),
      ]),
    ];

    const riskScores = records.flatMap((pullRequest) =>
      pullRequest.riskAssessments.map((risk) => ({
        pullRequest: pullRequest.number,
        repository: `${pullRequest.repository.owner}/${pullRequest.repository.name}`,
        score: risk.score,
        level: risk.level,
        modelVersion: risk.modelVersion,
        factors: risk.factors,
      })),
    );
    const policyResults = records.map((pullRequest) => ({
      pullRequest: pullRequest.number,
      repository: `${pullRequest.repository.owner}/${pullRequest.repository.name}`,
      action: pullRequest.policyDecisions[0]?.action ?? "UNKNOWN",
      explanation: redactAssessmentText(pullRequest.policyDecisions[0]?.explanation),
    }));
    const provenance = summarizeAssessmentProvenance(records);
    const limitationSources = Array.from(
      new Set(
        allEvidence
          .filter((evidence) => evidence.status === "NOT_RUN")
          .map((evidence) => evidence.source),
      ),
    );
    const limitations = [
      ...(selectedRepositories.length ? [] : ["No repositories were selected."]),
      ...(collected.length
        ? []
        : ["No pull requests with activity in the requested period were available."]),
      ...(records.some(
        (pullRequest) => pullRequest.codeChanges.length === 0 && pullRequest.changedFilesCount > 0,
      )
        ? ["At least one pull request had no persisted changed-file analysis."]
        : []),
      ...(limitationSources.length ? [`Providers not run: ${limitationSources.join(", ")}.`] : []),
      ...(repositorySecurityContext.some(
        (repository) => repository.secretScanning.result === "NOT_RUN",
      )
        ? [
            "Secret scanning was unavailable or not implemented for one or more selected repositories.",
          ]
        : []),
      ...(repositorySecurityContext.some((repository) => !repository.changeRequestsComplete)
        ? [
            "One or more provider change-request collections reached a pagination safety limit and may be incomplete.",
          ]
        : []),
      ...(repositorySecurityContext.some(
        (repository) =>
          repository.branchProtection["status"] === "UNKNOWN" ||
          repository.branchProtection["status"] === "NOT_RUN",
      )
        ? [
            "Branch-protection status is unknown or unavailable for one or more repositories; absence and permission denial cannot always be distinguished.",
          ]
        : []),
      ...(repositorySecurityContext.some((repository) => repository.provider === "GITHUB")
        ? [
            "GitHub Code Scanning alerts are current open alerts; an empty result does not prove that scanning is enabled or has completed successfully.",
            "Dependabot results are current open alerts; an empty result does not prove that dependency alerting is enabled or that every manifest is covered.",
          ]
        : []),
      ...(selectedRepositories.some((repository) => repository.provider !== "GITHUB")
        ? ["Dependency vulnerability scanning is not integrated for non-GitHub repositories."]
        : []),
      ...(selectedRepositories.some((repository) => repository.provider === "GITLAB")
        ? [
            "GitLab approvals are collected but are not linked to the current head commit by the available API response, so they are not counted as current-head approvals.",
          ]
        : []),
      ...(selectedRepositories.some((repository) => repository.provider === "BITBUCKET")
        ? [
            "Bitbucket pull requests updated during the selected period are included, but Bitbucket review participants are not linked to a review timestamp or current head and therefore are not counted as verified approvals.",
            "Bitbucket native secret scanning and webhook-triggered monitoring are not integrated; branch restriction configurations are collected but their effective enforcement is not verified.",
          ]
        : []),
      ...(selectedRepositories.some((repository) => repository.provider === "AZURE_DEVOPS")
        ? [
            "Azure DevOps pull-request collection uses the provider's creation-time query rather than a complete activity-history window; reviewer votes are not tied to a timestamp or current iteration.",
            "Azure DevOps Advanced Security alerts are a point-in-time list of current active findings, not proof of scanner coverage across the assessment's historical window; an empty alert list does not prove that scanning is enabled or complete.",
            "Branch-policy reporting only reflects configuration data returned for exact branch scopes; policy semantics are not independently evaluated.",
          ]
        : []),
      "Pull-request files and risk are analysed at the available head SHA when the assessment runs; intermediate historical revisions are not reconstructed.",
      "Source-control history does not identify every AI-generated change; the provenance denominator is pull requests with activity in this window, classified from recorded provenance evidence.",
      ...(selectedRepositories.some((repository) => repository.provider === "GITHUB")
        ? [
            "GitHub history is bounded by the GitHub App's current access and the 3,000-pull-request API safety limit per repository.",
          ]
        : []),
      ...(selectedRepositories.some((repository) => repository.provider === "GITLAB")
        ? [
            "GitLab history is bounded by the OAuth user's current project access and the adapter's 10,000-merge-request pagination safety limit per project.",
          ]
        : []),
      ...(selectedRepositories.some((repository) => repository.provider === "BITBUCKET")
        ? [
            "Bitbucket history is bounded by the OAuth user's current workspace access and the adapter's pagination safety limit.",
          ]
        : []),
    ];
    const approvedPullRequests = collected.filter((item) =>
      isApprovedOnHead(item.reviews, item.pullRequest.head?.sha ?? null),
    ).length;
    const pullRequestSecurityEvidence = allEvidence.filter(
      (evidence) =>
        evidence.pullRequest !== null &&
        ["SAST", "SECRET_SCAN", "SCA", "SECURITY_FINDINGS"].includes(evidence.type),
    );
    const githubRepositoryContexts = repositorySecurityContext.filter(
      (repository) => repository.provider === "GITHUB",
    );
    const codeScanningResults = githubRepositoryContexts.map(
      (repository) => repository.codeScanning,
    );
    const dependabotResults = githubRepositoryContexts.map((repository) => repository.dependabot);
    const repositoryAlertCoverageStatus = (
      results: RepositoryAlertResult[],
    ): AssessmentCoverageStatus => {
      if (githubRepositoryContexts.length === 0) return "NOT_CONFIGURED";
      if (results.some((result) => result.result === "NOT_RUN")) {
        return results.some((result) => result.result === "FAIL") ? "PARTIAL" : "NOT_RUN";
      }
      return results.some((result) => result.result === "UNKNOWN") ? "PARTIAL" : "ASSESSED";
    };
    const secretScanResults = repositorySecurityContext.map(
      (repository) => repository.secretScanning.result,
    );
    const branchProtectionResults = repositorySecurityContext.map((repository) => {
      const status = repository.branchProtection["status"];
      return typeof status === "string" ? status : "UNKNOWN";
    });
    const policyHasUnknown = policyResults.some((result) => result.action === "UNKNOWN");
    const coverage: AssessmentCoverageItem[] = [
      {
        area: "Pull-request activity",
        status: records.length > 0 ? "ASSESSED" : "NOT_RUN",
        scope: `${records.length} pull requests`,
        detail:
          records.length > 0
            ? "Risk analysis ran on pull requests with activity in the assessment window."
            : "No pull requests with activity were available; no PR-level risk conclusion was possible.",
      },
      {
        area: "Pull-request security checks",
        status:
          records.length === 0 || pullRequestSecurityEvidence.length === 0
            ? "NOT_RUN"
            : pullRequestSecurityEvidence.some((evidence) =>
                  ["UNKNOWN", "NOT_RUN"].includes(evidence.status),
                )
              ? "PARTIAL"
              : "ASSESSED",
        scope: `${pullRequestSecurityEvidence.length} evidence records`,
        detail:
          records.length === 0
            ? "No recent pull requests were available for head-specific security checks."
            : pullRequestSecurityEvidence.length === 0
              ? "No supported pull-request security-check evidence was returned."
              : "Status reflects the collected pull-request evidence; a missing or unrun check is not a pass.",
      },
      ...(githubRepositoryContexts.length > 0
        ? [
            {
              area: "GitHub Code Scanning alerts",
              status: repositoryAlertCoverageStatus(codeScanningResults),
              scope: `${codeScanningResults.filter((result) => result.result !== "NOT_RUN").length}/${githubRepositoryContexts.length} GitHub repositories returned alerts data`,
              detail:
                "These are current open alerts. An empty result does not establish that scanning is enabled or complete.",
            },
            {
              area: "GitHub Dependabot alerts",
              status: repositoryAlertCoverageStatus(dependabotResults),
              scope: `${dependabotResults.filter((result) => result.result !== "NOT_RUN").length}/${githubRepositoryContexts.length} GitHub repositories returned alerts data`,
              detail:
                "These are current provider alerts. An empty result does not prove alerting is enabled or every manifest is covered.",
            },
          ]
        : [
            {
              area: "Dependency vulnerability scanning",
              status: "NOT_CONFIGURED" as const,
              scope: "Not available for selected providers",
              detail:
                "No dependency vulnerability scanner is integrated for the selected providers.",
            },
          ]),
      {
        area: "Secret scanning",
        status:
          secretScanResults.length === 0 ||
          secretScanResults.every((result) => result === "NOT_RUN")
            ? "NOT_RUN"
            : secretScanResults.every((result) => ["PASS", "FAIL"].includes(result))
              ? "ASSESSED"
              : "PARTIAL",
        scope: `${secretScanResults.filter((result) => result !== "NOT_RUN").length}/${selectedRepositories.length} repositories returned a determinate result`,
        detail:
          "Provider alerts are point-in-time data; a clean alert response does not prove historical scan coverage.",
      },
      {
        area: "Branch protection",
        status:
          branchProtectionResults.length > 0 &&
          branchProtectionResults.every((status) => ["AVAILABLE", "PASS", "FAIL"].includes(status))
            ? "ASSESSED"
            : branchProtectionResults.some((status) =>
                  ["AVAILABLE", "PASS", "FAIL"].includes(status),
                )
              ? "PARTIAL"
              : "NOT_RUN",
        scope: `${branchProtectionResults.filter((status) => ["AVAILABLE", "PASS", "FAIL"].includes(status)).length}/${selectedRepositories.length} repositories returned visible branch settings`,
        detail:
          "Provider-specific limitations and the exact default-branch result are listed below; visible configuration is not always proof of effective enforcement.",
      },
      {
        area: "Pull-request policy",
        status: policyResults.length === 0 ? "NOT_RUN" : policyHasUnknown ? "PARTIAL" : "ASSESSED",
        scope: `${policyResults.filter((result) => result.action !== "UNKNOWN").length}/${policyResults.length} pull requests have a recorded decision`,
        detail:
          "Decisions reflect organization policies and platform safeguards at assessment time.",
      },
      {
        area: "Review coverage",
        status: records.length > 0 ? "ASSESSED" : "NOT_RUN",
        scope: `${approvedPullRequests}/${records.length} pull requests approved on the current head`,
        detail:
          "Approval coverage is measured only where the provider supplies verifiable review evidence for the current head.",
      },
      {
        area: "AI provenance",
        status:
          records.length === 0
            ? "NOT_RUN"
            : provenance.classifications.UNKNOWN > 0
              ? "PARTIAL"
              : "ASSESSED",
        scope: `${records.length - provenance.classifications.UNKNOWN}/${records.length} pull requests have a classified signal`,
        detail:
          "Classifications describe available provenance evidence and do not prove that an entire change was or was not AI-generated.",
      },
    ];
    const readout = buildAssessmentReadout({
      pullRequestsAnalysed: records.length,
      findingCount: allFindingRows.length,
      coverage,
    });

    const report = {
      schemaVersion: 2,
      assessmentId,
      generatedAt: new Date().toISOString(),
      period: {
        start: assessment.windowStart.toISOString(),
        end: assessment.windowEnd.toISOString(),
        days: 30,
      },
      permissionsSnapshot: assessment.permissionsSnapshot,
      repositories: selectedRepositories.map((repository) => ({
        id: repository.id,
        provider: repository.provider,
        fullName: `${repository.owner}/${repository.name}`,
      })),
      summary: {
        readout,
        coverage,
        pullRequestsAnalysed: records.length,
        highestPullRequestRiskScore: getHighestPullRequestRiskScore(riskScores),
        riskScoreMethod:
          "Highest persisted risk-v2 score among analysed pull requests. Repository-level native security alerts are not inputs to those per-PR scores. This is not a certification, benchmark, or whole-repository score.",
        riskScoringMethodology: {
          version: "risk-v2",
          perPullRequest:
            "Add the factor values below, round to the nearest integer, and clamp the score to 0-100.",
          factors: {
            aiInvolvement: {
              YES: "35 + 25 * confidence (0-1)",
              UNKNOWN: "10 + 10 * confidence (0-1)",
              NO: 0,
            },
            repositoryCriticality: { LOW: 0, MEDIUM: 10, HIGH: 20, CRITICAL: 30 },
            sensitiveAreas: {
              weights: {
                AUTHENTICATION: 12,
                AUTHORIZATION: 12,
                PAYMENTS: 12,
                CRYPTOGRAPHY: 12,
                SECRETS: 12,
                DATABASE: 9,
                PERSONAL_DATA: 10,
                INFRASTRUCTURE: 10,
                NETWORKING: 8,
                API: 8,
                DEPENDENCIES: 8,
                CI_CD: 7,
                CONTAINERS: 7,
                LOGGING: 5,
                FRONTEND: 4,
                TESTING: 4,
                DOCUMENTATION: 2,
              },
              cap: 40,
            },
            changeSize:
              "min(20, 2 * sqrt(additions + deletions) * min(1.5, 1 + changedFiles / 20))",
            dependencyManifestFilesChanged:
              "6 per changed manifest file; capped at 15; does not assess versions",
            securityFindings: {
              perFinding: { INFO: 0, LOW: 4, MEDIUM: 8, HIGH: 16, CRITICAL: 24 },
              cap: 30,
            },
            evidenceOutcomes: {
              perItem: { PASS: 0, FAIL: 10, UNKNOWN: 5, NOT_RUN: 5, NOT_APPLICABLE: 0 },
              cap: 20,
            },
          },
          levels: { LOW: "0-34", MEDIUM: "35-59", HIGH: "60-79", CRITICAL: "80-100" },
          assessmentAggregate:
            "The report shows the highest actual per-PR score. If no PR risk records exist, it reports no score.",
          excluded:
            "Repository-level security alerts are displayed separately and do not change per-pull-request risk-v2 scores.",
        },
        findingsBySeverity: severityCounts,
        findings: allFindingRows,
        secretDetection: {
          repositories: repositorySecurityContext.map(
            ({ repositoryId, provider, fullName, secretScanning }) => ({
              repositoryId,
              provider,
              repository: fullName,
              ...secretScanning,
            }),
          ),
          findings: repositorySecurityContext.flatMap((repository) =>
            repository.secretScanning.result === "NOT_RUN"
              ? []
              : repository.secretScanning.alerts.map((alert) => ({
                  ...alert,
                  repository: repository.fullName,
                  severity: "UNRATED",
                  source:
                    repository.provider === "AZURE_DEVOPS"
                      ? "Azure DevOps Advanced Security"
                      : repository.provider === "GITHUB"
                        ? "GitHub Secret Scanning"
                        : "Provider secret scanning",
                })),
          ),
          note: "Shows current provider alerts for selected repositories where supported and authorized; secret values are never returned or stored. This is not a historical count of alerts created in the 30-day period, and an empty result does not prove scanner configuration or coverage.",
        },
        repositorySecurityAlerts: repositorySecurityContext.map((repository) => ({
          repository: repository.fullName,
          codeScanning: repository.codeScanning,
          dependabot: repository.dependabot,
        })),
        branchProtection: repositorySecurityContext.map(
          ({ repositoryId, fullName, branchProtection }) => ({
            repositoryId,
            repository: fullName,
            ...branchProtection,
          }),
        ),
        dependencyRisks: {
          findings: allFindingRows.filter((finding) => finding.category === "SCA"),
          dependencyManifestChanges: records.flatMap((pullRequest) =>
            pullRequest.codeChanges
              .filter((change) => isDependencyManifestPath(change.filePath))
              .map(
                (change) =>
                  `${pullRequest.repository.owner}/${pullRequest.repository.name}:${change.filePath}`,
              ),
          ),
          note: "GitHub Dependabot results are current open provider alerts; other providers are not dependency-scanned here. Manifest changes are listed as observed file changes and do not prove dependency vulnerability coverage.",
        },
        licenceAndSupplyChain: {
          result: "NOT_RUN",
          note: "Licence and broader supply-chain analysis are not configured.",
        },
        reviewCoverage: {
          approvedOnCurrentHead: approvedPullRequests,
          pullRequests: collected.length,
          percentage:
            collected.length > 0
              ? Math.round((approvedPullRequests / collected.length) * 100)
              : null,
          method:
            "Counts PRs with at least one GitHub APPROVED review whose commit_id matches the current PR head SHA.",
        },
        policyCoverage: {
          decisions: policyResults,
          assessedPullRequests: policyResults.filter((result) => result.action !== "UNKNOWN")
            .length,
          totalPullRequests: records.length,
        },
        aiProvenance: {
          classifications: provenance.classifications,
          denominator: records.length,
          coverage: provenance.coverage,
          denominatorDefinition: "Pull requests with activity in the selected 30-day window.",
          records: provenance.records,
          confidenceInterpretation:
            "Confidence describes confidence in detecting the recorded signal, not the probability that all change content was AI-generated.",
          classificationMethod:
            "Uses only a first-class provenance signal bound to the pull request's current head SHA. Missing, stale, unsupported, or invalid-confidence signals are UNKNOWN. OBSERVED identifies a recorded signal, not proof that the full change was AI-authored; DECLARED is unverified developer-provided evidence; INFERRED is explicitly heuristic.",
        },
        riskFactors: riskScores,
        securityEvidence: allEvidence,
        governanceGaps: [
          ...limitations,
          ...(records.some((pullRequest) => pullRequest.policyDecisions.length === 0)
            ? ["Some analysed pull requests have no persisted policy decision."]
            : []),
          ...(records.length > 0 && approvedPullRequests < records.length
            ? ["Some pull requests have no approval recorded on their current head."]
            : []),
        ],
        recommendedActions: [
          ...buildAssessmentRecommendedActions({
            pullRequestsAnalysed: records.length,
            coverage,
            findings: allFindingRows.map((finding) => ({
              id: finding.id,
              severity: finding.severity,
              title: typeof finding.title === "string" ? finding.title : "security finding",
              provider: typeof finding.provider === "string" ? finding.provider : "Security",
            })),
          }),
          ...repositorySecurityContext.flatMap((repository) =>
            repository.secretScanning.result === "FAIL"
              ? repository.secretScanning.alerts.map((alert) => ({
                  priority: "REVIEW",
                  action: `Review current ${repository.provider === "AZURE_DEVOPS" ? "Azure DevOps Advanced Security" : "GitHub Secret Scanning"} alert ${String(alert["id"])} in ${repository.fullName}.`,
                  evidenceId: alert["evidenceUrl"] ?? alert["id"] ?? null,
                }))
              : [],
          ),
          ...(limitationSources.length
            ? [
                {
                  priority: "MEDIUM",
                  action:
                    "Configure and run the unavailable security providers for selected repositories.",
                  evidenceId: null,
                },
              ]
            : []),
          ...(approvedPullRequests < collected.length
            ? [
                {
                  priority: "MEDIUM",
                  action: "Review pull requests without an approval on the current head SHA.",
                  evidenceId: null,
                },
              ]
            : []),
        ],
        analysisVersions: {
          risk: Array.from(new Set(riskScores.map((risk) => risk.modelVersion))),
          policy: "Organization policies and platform safeguards in effect at assessment time.",
          providers: Array.from(new Set(allEvidence.map((evidence) => evidence.source))),
        },
        limitations,
      },
    };

    const completedWithLimitations = limitations.length > 0;
    const completed = await prisma.assessment.updateMany({
      where: { id: assessmentId, status: "RUNNING" },
      data: {
        status: completedWithLimitations ? "COMPLETED_WITH_LIMITATIONS" : "COMPLETED",
        report: report as Prisma.InputJsonValue,
        progress: 100,
        processedPullRequests: records.length,
        completedAt: new Date(),
        errorCode: null,
        errorMessage: null,
      },
    });
    if (completed.count !== 1) return;
    await reserveUsage(
      assessment.organizationId,
      "ASSESSMENT_COMPLETED",
      `assessment-completed:${assessmentId}`,
      { assessmentId, pullRequestsAnalysed: records.length },
    );
    await recordAuditEvent({
      organizationId: assessment.organizationId,
      eventType: "ASSESSMENT_COMPLETED",
      metadata: {
        assessmentId,
        status: completedWithLimitations ? "COMPLETED_WITH_LIMITATIONS" : "COMPLETED",
      },
    });
    try {
      await notifyOrganizationRoles({
        organizationId: assessment.organizationId,
        roles: ["OWNER", "ADMIN", "SECURITY"],
        type: "ASSESSMENT_COMPLETED",
        title: completedWithLimitations
          ? "Assessment completed with limitations"
          : "Assessment completed",
        body: completedWithLimitations
          ? "Your repository assessment completed with one or more documented coverage limitations."
          : "Your repository assessment completed. Review its findings and evidence.",
        href: "/dashboard/assessment",
        dedupeKey: `assessment-completed:${assessmentId}`,
      });
    } catch (notificationError) {
      console.error("[assessment] completion notification could not be persisted", {
        assessmentId,
        error: notificationError,
      });
    }
    console.log(
      `[${JOB_TYPES.ASSESSMENT_RUN}] assessment=${assessmentId} status=${completedWithLimitations ? "COMPLETED_WITH_LIMITATIONS" : "COMPLETED"} pullRequests=${records.length}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Assessment processing failed";
    const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    const failed = await prisma.assessment.updateMany({
      where: { id: assessmentId, status: { not: "CANCELLED" } },
      data: {
        status: lastAttempt ? "FAILED" : "QUEUED",
        errorCode: lastAttempt ? "ASSESSMENT_PROVIDER_FAILED" : null,
        errorMessage: lastAttempt
          ? "Assessment processing failed after retry attempts. Check worker logs for the provider error."
          : null,
      },
    });
    if (lastAttempt && failed.count > 0) {
      try {
        await notifyOrganizationRoles({
          organizationId: assessment.organizationId,
          roles: ["OWNER", "ADMIN", "SECURITY"],
          type: "ASSESSMENT_FAILED",
          title: "Assessment failed",
          body: "A repository assessment failed after retry attempts. Review the assessment status and worker logs.",
          href: "/dashboard/assessment",
          dedupeKey: `assessment-failed:${assessmentId}`,
        });
      } catch (notificationError) {
        console.error("[assessment] failure notification could not be persisted", {
          assessmentId,
          error: notificationError,
        });
      }
    }
    console.error(
      `[${JOB_TYPES.ASSESSMENT_RUN}] assessment=${assessmentId} attempt=${job.attemptsMade + 1} failed: ${message}`,
    );
    throw error;
  }
}
