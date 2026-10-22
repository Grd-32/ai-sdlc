"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowDownToLine, LoaderCircle, Play, RotateCcw, X } from "lucide-react";
import type { AssessmentRecord, RepositorySummary } from "@/lib/api";
import { trackProductEvent } from "@/components/product-analytics";

interface ApiResponse<T> {
  data: T | null;
  error: { code: string; message: string } | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function displayValue(value: unknown, fallback = "Not available"): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : fallback;
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

function reportSummary(assessment: AssessmentRecord | null): Record<string, unknown> | null {
  const summary = assessment?.report?.["summary"];
  return isRecord(summary) ? summary : null;
}

function getReportReadout(
  summary: Record<string, unknown>,
  findingCount: number,
): Record<string, unknown> {
  if (isRecord(summary["readout"])) return summary["readout"];
  const pullRequestsAnalysed =
    typeof summary["pullRequestsAnalysed"] === "number" ? summary["pullRequestsAnalysed"] : 0;
  if (findingCount > 0) {
    return {
      outcome: "FINDINGS_DETECTED",
      headline: `${findingCount} security finding${findingCount === 1 ? "" : "s"} detected in the assessed scope.`,
      conclusion:
        pullRequestsAnalysed === 0
          ? "Review repository-level findings. No recent pull requests were available, so no PR-level risk, policy, review, or AI-provenance conclusion can be drawn."
          : "Review the findings and evidence. This report covers only the repositories, pull requests, and provider data listed below.",
    };
  }
  if (pullRequestsAnalysed === 0) {
    return {
      outcome: "NO_RECENT_PULL_REQUESTS",
      headline: "No pull requests with activity in this period were available to assess.",
      conclusion:
        "No pull-request risk, policy, review, or AI-provenance conclusion can be drawn. Empty findings do not mean the repository is free of risk.",
    };
  }
  return {
    outcome: "LIMITED_COVERAGE",
    headline: "No findings were returned, but assessment coverage is incomplete.",
    conclusion:
      "Treat this as results for the evidence actually collected, not as confirmation that the repository is secure.",
  };
}

function getReportCoverage(summary: Record<string, unknown>): Array<Record<string, unknown>> {
  if (Array.isArray(summary["coverage"])) return summary["coverage"].filter(isRecord);
  const pullRequestCount =
    typeof summary["pullRequestsAnalysed"] === "number" ? summary["pullRequestsAnalysed"] : 0;
  const repositories = Array.isArray(summary["repositories"])
    ? summary["repositories"].filter(isRecord)
    : [];
  const githubRepositoryCount = repositories.filter((item) => item["provider"] === "GITHUB").length;
  const secretRepositories = isRecord(summary["secretDetection"])
    ? summary["secretDetection"]["repositories"]
    : null;
  const secretResults = Array.isArray(secretRepositories)
    ? secretRepositories.filter(isRecord).map((item) => item["result"])
    : [];
  const secretStatus =
    secretResults.length === 0 || secretResults.every((status) => status === "NOT_RUN")
      ? "NOT_RUN"
      : secretResults.every((status) => status === "PASS" || status === "FAIL")
        ? "ASSESSED"
        : "PARTIAL";
  const branchProtection = Array.isArray(summary["branchProtection"])
    ? summary["branchProtection"].filter(isRecord)
    : [];
  const branchStatuses = branchProtection.map((item) => item["status"]);
  const determinateBranchCount = branchStatuses.filter((status) =>
    ["AVAILABLE", "PASS", "FAIL"].includes(String(status)),
  ).length;
  const policyDecisions = isRecord(summary["policyCoverage"])
    ? summary["policyCoverage"]["decisions"]
    : null;
  const decisions = Array.isArray(policyDecisions) ? policyDecisions.filter(isRecord) : [];
  const provenance = isRecord(summary["aiProvenance"]) ? summary["aiProvenance"] : {};
  const classifications = isRecord(provenance["classifications"])
    ? provenance["classifications"]
    : {};
  const unknownProvenance =
    typeof classifications["UNKNOWN"] === "number" ? classifications["UNKNOWN"] : 0;
  const evidence = Array.isArray(summary["securityEvidence"])
    ? summary["securityEvidence"].filter(isRecord)
    : [];
  const reviewCoverage = isRecord(summary["reviewCoverage"]) ? summary["reviewCoverage"] : {};
  const approved =
    typeof reviewCoverage["approvedOnCurrentHead"] === "number"
      ? reviewCoverage["approvedOnCurrentHead"]
      : 0;

  return [
    {
      area: "Pull-request activity",
      status: pullRequestCount > 0 ? "ASSESSED" : "NOT_RUN",
      scope: `${pullRequestCount} pull requests`,
      detail:
        pullRequestCount > 0
          ? "Risk analysis ran on pull requests with activity in the assessment window."
          : "No pull requests with activity were available; no PR-level risk conclusion was possible.",
    },
    {
      area: "Pull-request security checks",
      status:
        pullRequestCount === 0 || evidence.length === 0
          ? "NOT_RUN"
          : evidence.some((item) => ["NOT_RUN", "UNKNOWN"].includes(String(item["status"])))
            ? "PARTIAL"
            : "ASSESSED",
      scope: `${evidence.length} evidence records`,
      detail: "A missing or unrun check is not a pass.",
    },
    {
      area: "Secret scanning",
      status: secretStatus,
      scope: `${secretResults.filter((status) => status !== "NOT_RUN").length} repositories returned a determinate result`,
      detail: "Point-in-time alerts do not prove historical scan coverage.",
    },
    {
      area: "Branch protection",
      status:
        determinateBranchCount === branchProtection.length && branchProtection.length > 0
          ? "ASSESSED"
          : determinateBranchCount > 0
            ? "PARTIAL"
            : "NOT_RUN",
      scope: `${determinateBranchCount}/${branchProtection.length} repositories returned visible branch settings`,
      detail: "Visible configuration is not always proof of effective enforcement.",
    },
    ...(githubRepositoryCount > 0
      ? [
          {
            area: "GitHub Code Scanning alerts",
            status: "NOT_RUN",
            scope: "Not collected in this saved report",
            detail: "This report predates repository-wide Code Scanning alert collection.",
          },
          {
            area: "GitHub Dependabot alerts",
            status: "NOT_RUN",
            scope: "Not collected in this saved report",
            detail: "This report predates repository-wide Dependabot alert collection.",
          },
        ]
      : [
          {
            area: "Dependency vulnerability scanning",
            status: "NOT_CONFIGURED",
            scope: "Not included",
            detail: "Manifest changes are not a dependency vulnerability scan.",
          },
        ]),
    {
      area: "Pull-request policy",
      status:
        decisions.length === 0
          ? "NOT_RUN"
          : decisions.some((item) => item["action"] === "UNKNOWN")
            ? "PARTIAL"
            : "ASSESSED",
      scope: `${decisions.filter((item) => item["action"] !== "UNKNOWN").length}/${decisions.length} pull requests have a recorded decision`,
      detail: "Decisions reflect policy and safeguards at assessment time.",
    },
    {
      area: "Review coverage",
      status: pullRequestCount > 0 ? "ASSESSED" : "NOT_RUN",
      scope: `${approved}/${pullRequestCount} pull requests approved on the current head`,
      detail: "Approval coverage depends on verifiable provider review evidence.",
    },
    {
      area: "AI provenance",
      status: pullRequestCount === 0 ? "NOT_RUN" : unknownProvenance > 0 ? "PARTIAL" : "ASSESSED",
      scope: `${Math.max(0, pullRequestCount - unknownProvenance)}/${pullRequestCount} pull requests have a classified signal`,
      detail:
        "Available provenance signals do not prove that a whole change was or was not AI-generated.",
    },
  ];
}

function getRecommendedActions(
  summary: Record<string, unknown>,
  coverage: Array<Record<string, unknown>>,
): unknown[] {
  const savedActions = Array.isArray(summary["recommendedActions"])
    ? summary["recommendedActions"]
    : [];
  if (savedActions.length > 0) return savedActions;
  const actions: Array<{ priority: string; action: string; evidenceId: null }> = [];
  const pullRequestCount =
    typeof summary["pullRequestsAnalysed"] === "number" ? summary["pullRequestsAnalysed"] : 0;
  if (pullRequestCount === 0) {
    actions.push({
      priority: "NEXT_STEP",
      action:
        "Open or update a pull request in a selected repository, then run a new assessment to get pull-request risk, policy, review, and provenance results.",
      evidenceId: null,
    });
  }
  for (const item of coverage) {
    if (
      item["status"] === "ASSESSED" ||
      (pullRequestCount === 0 && item["area"] === "Pull-request activity")
    ) {
      continue;
    }
    actions.push({
      priority: "MEDIUM",
      action:
        item["area"] === "Secret scanning"
          ? "Enable provider secret scanning and grant the connected app read access to its alerts, then rerun the assessment."
          : item["area"] === "GitHub Code Scanning alerts"
            ? "Enable Code Scanning and grant the GitHub App Code scanning alerts: read permission, then approve the updated installation permissions."
            : item["area"] === "GitHub Dependabot alerts"
              ? "Enable Dependabot alerts and grant the GitHub App Dependabot alerts: read permission, then approve the updated installation permissions."
              : item["area"] === "Branch protection"
                ? "Verify protection on each repository's default branch and grant read access if the settings are not visible."
                : item["area"] === "Dependency vulnerability scanning"
                  ? "Run a dependency vulnerability scan; manifest changes in this report are not a vulnerability scan."
                  : item["area"] === "AI provenance"
                    ? "Record provenance evidence where available; unknown is not proof of AI use or non-use."
                    : item["area"] === "Pull-request policy"
                      ? "Review organization policy configuration and ensure each assessed pull request has a recorded decision."
                      : item["area"] === "Pull-request security checks"
                        ? "Configure and run supported security checks for the pull-request head."
                        : item["area"] === "Review coverage"
                          ? "Require and record reviewer approvals on the current pull-request head."
                          : `Improve coverage for ${displayValue(item["area"]).toLowerCase()}.`,
      evidenceId: null,
    });
  }
  return actions;
}

const RUNNING_STATES = new Set(["CREATED", "AUTHORIZATION_PENDING", "QUEUED", "RUNNING"]);

export function AssessmentConsole({
  organizationId,
  repositories,
  initialAssessments,
  canManage,
}: {
  organizationId: string;
  repositories: RepositorySummary[];
  initialAssessments: AssessmentRecord[];
  canManage: boolean;
}) {
  const [assessments, setAssessments] = useState(initialAssessments);
  const [selectedRepositoryIds, setSelectedRepositoryIds] = useState<string[]>([]);
  const [selectedAssessmentId, setSelectedAssessmentId] = useState<string | null>(
    initialAssessments[0]?.id ?? null,
  );
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const completedIds = useRef(
    new Set(
      initialAssessments
        .filter((assessment) =>
          ["COMPLETED", "COMPLETED_WITH_LIMITATIONS"].includes(assessment.status),
        )
        .map((assessment) => assessment.id),
    ),
  );
  const viewedReportIds = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    const response = await fetch(
      `/api/backend/api/organizations/${encodeURIComponent(organizationId)}/assessments`,
      { cache: "no-store" },
    );
    const payload = (await response.json()) as ApiResponse<AssessmentRecord[]>;
    if (!response.ok || !payload.data) {
      throw new Error(payload.error?.message ?? "Unable to refresh assessment history.");
    }
    for (const assessment of payload.data) {
      if (
        ["COMPLETED", "COMPLETED_WITH_LIMITATIONS"].includes(assessment.status) &&
        !completedIds.current.has(assessment.id)
      ) {
        completedIds.current.add(assessment.id);
        trackProductEvent("assessment_completed");
      }
    }
    setAssessments(payload.data);
    setSelectedAssessmentId((current) =>
      current && payload.data?.some((item) => item.id === current)
        ? current
        : (payload.data?.[0]?.id ?? null),
    );
  }, [organizationId]);

  const selected = assessments.find((item) => item.id === selectedAssessmentId) ?? null;
  const selectedSummary = reportSummary(selected);
  const findings = Array.isArray(selectedSummary?.["findings"])
    ? selectedSummary["findings"].filter(isRecord)
    : [];
  const reportReadout = selectedSummary ? getReportReadout(selectedSummary, findings.length) : null;
  const reportCoverage = selectedSummary ? getReportCoverage(selectedSummary) : [];
  const recommendedActions = selectedSummary
    ? getRecommendedActions(selectedSummary, reportCoverage)
    : [];

  useEffect(() => {
    if (!assessments.some((item) => RUNNING_STATES.has(item.status))) return;
    const timer = window.setInterval(() => {
      void refresh().catch((refreshError: unknown) =>
        setError(
          refreshError instanceof Error ? refreshError.message : "Unable to refresh status.",
        ),
      );
    }, 3000);
    return () => window.clearInterval(timer);
  }, [assessments, refresh]);

  const activeRepositories = useMemo(
    () => repositories.filter((repository) => repository.enabled),
    [repositories],
  );

  function toggleRepository(repositoryId: string) {
    setSelectedRepositoryIds((current) =>
      current.includes(repositoryId)
        ? current.filter((id) => id !== repositoryId)
        : current.length < 10
          ? [...current, repositoryId]
          : current,
    );
  }

  async function submitAction(
    path: string,
    init: RequestInit,
    successMessage: string,
  ): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/backend/api/organizations/${encodeURIComponent(organizationId)}/assessments${path}`,
        { ...init, cache: "no-store" },
      );
      const payload = (await response.json()) as ApiResponse<unknown>;
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Assessment request failed.");
      }
      if (path === "" || path.endsWith("/retry")) {
        trackProductEvent("assessment_started");
      }
      await refresh();
      setNotice(successMessage);
    } catch (actionError) {
      setNotice(null);
      setError(actionError instanceof Error ? actionError.message : "Assessment request failed.");
    } finally {
      setBusy(false);
    }
  }

  function startAssessment() {
    void submitAction(
      "",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          repositoryIds: selectedRepositoryIds,
          dataProcessingAcknowledged: acknowledged,
        }),
      },
      "Assessment queued.",
    );
  }

  const cancellable = selected ? RUNNING_STATES.has(selected.status) : false;
  const retryable = selected?.status === "FAILED" && selected.attempt < 3;
  const reportReady =
    selected?.status === "COMPLETED" || selected?.status === "COMPLETED_WITH_LIMITATIONS";

  useEffect(() => {
    if (!reportReady || viewedReportIds.current.has(selected.id)) return;
    viewedReportIds.current.add(selected.id);
    trackProductEvent("report_viewed");
  }, [reportReady, selected]);

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-orange-800">
          Free AI risk assessment
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">
          Assess repository activity
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Select up to 10 connected repositories. Nomalog reviews pull requests or merge requests
          updated in the previous 30 days through the shared risk, policy, evidence, and provenance
          pipeline.
        </p>
      </header>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          {notice}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(19rem,0.7fr)]">
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold text-slate-900">Repository scope</h2>
              <p className="mt-1 text-sm text-slate-600">
                Only the repositories checked here will be included.
              </p>
            </div>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
              Previous 30 days
            </span>
          </div>

          <div className="mt-4 max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200">
            {activeRepositories.length === 0 ? (
              <p className="p-4 text-sm text-slate-600">
                No active repositories are connected. Connect one from{" "}
                <a
                  className="font-semibold text-orange-800 underline"
                  href="/dashboard/repositories"
                >
                  Repositories
                </a>
                .
              </p>
            ) : (
              activeRepositories.map((repository) => (
                <label
                  key={repository.id}
                  className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={selectedRepositoryIds.includes(repository.id)}
                    onChange={() => toggleRepository(repository.id)}
                    disabled={
                      !canManage ||
                      (selectedRepositoryIds.length >= 10 &&
                        !selectedRepositoryIds.includes(repository.id))
                    }
                    className="h-4 w-4 rounded border-slate-300 text-orange-700 focus:ring-orange-600"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">
                      {repository.owner}/{repository.name}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {repository.provider === "GITHUB"
                        ? `GitHub App permissions: ${
                            repository.installation?.permissions
                              ? Object.entries(repository.installation.permissions)
                                  .map(([scope, permission]) => `${scope} ${permission}`)
                                  .join(", ")
                              : "not reported"
                          }`
                        : `${repository.provider} read-only OAuth connection`}
                    </span>
                  </span>
                  <span className="text-right text-xs text-slate-500">
                    {repository.criticality} criticality
                    <span className="block">{repository._count.pullRequests} PRs connected</span>
                  </span>
                </label>
              ))
            )}
          </div>

          <label className="mt-4 flex items-start gap-3 text-sm leading-5 text-slate-700">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              disabled={!canManage}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-orange-700 focus:ring-orange-600"
            />
            <span>
              I authorize Nomalog to process the selected repositories’ pull-request metadata,
              changed-file paths and diffs, review events, and available security evidence to
              generate this report. If Azure AI code review is enabled for this deployment, diffs
              may be sent to that configured provider.
            </span>
          </label>

          {canManage ? (
            <button
              type="button"
              disabled={busy || !acknowledged || selectedRepositoryIds.length === 0}
              onClick={startAssessment}
              className="mt-4 inline-flex items-center gap-2 rounded-md bg-orange-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Start assessment
            </button>
          ) : (
            <p className="mt-4 text-sm text-slate-500">
              Organization administrator access is required to authorize an assessment.
            </p>
          )}
        </section>

        <aside className="space-y-4">
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="font-semibold text-slate-900">Access and analysis</h2>
            <ul className="mt-3 space-y-2 text-sm leading-5 text-slate-600">
              <li>
                Uses the existing GitHub App installation; tokens stay server-side and expire.
              </li>
              <li>
                The assessment makes read-only GitHub requests and does not execute repository code
                or publish checks. Permission rows show the existing installation grants; these may
                also support other Nomalog features.
              </li>
              <li>
                Uses existing CodeQL alerts, stored findings, deterministic risk, policy, and
                provenance records where available.
              </li>
              <li>
                GitHub Code Scanning and Secret Scanning are read when available. Semgrep, Snyk,
                Sonar, licence scans, and dependency vulnerability scans are not configured;
                branch-protection collection may be unavailable.
              </li>
              <li>
                Reports expire and are automatically deleted after 90 days. Assessment-specific
                report deletion is available below.
              </li>
              <li>
                Source diffs are processed transiently and are not included in the report; analysis
                evidence in the organization remains subject to the workspace’s existing retention.
              </li>
            </ul>
            <p className="mt-3 border-t border-slate-100 pt-3 text-xs leading-5 text-slate-500">
              Revoke provider access at any time by uninstalling the Nomalog GitHub App from your
              GitHub organization’s installed-app settings. Cancel stops assessment processing
              between pull requests.
            </p>
          </section>
          <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-5 text-amber-950">
            <div className="flex gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                Git history cannot prove that every AI-assisted change is AI-generated. Missing or
                unavailable evidence is reported as unknown or not run, never as a pass.
              </p>
            </div>
          </section>
        </aside>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="font-semibold text-slate-900">Assessment history</h2>
            <p className="mt-1 text-xs text-slate-500">Reports are private to this organization.</p>
          </div>
          <button
            type="button"
            onClick={() =>
              void refresh().catch((refreshError: unknown) => setError(String(refreshError)))
            }
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Refresh
          </button>
        </div>
        {assessments.length === 0 ? (
          <p className="px-5 py-8 text-sm text-slate-600">No assessments have been run yet.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {assessments.map((assessment) => (
              <button
                type="button"
                key={assessment.id}
                onClick={() => setSelectedAssessmentId(assessment.id)}
                className={`flex w-full flex-wrap items-center gap-3 px-5 py-3 text-left hover:bg-slate-50 ${
                  assessment.id === selectedAssessmentId ? "bg-orange-50/60" : ""
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-900">
                    {assessment.repositories
                      .map((repository) => `${repository.owner}/${repository.name}`)
                      .join(", ")}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {new Date(assessment.createdAt).toLocaleString()} ·{" "}
                    {assessment.processedPullRequests}
                    {assessment.totalPullRequests ? `/${assessment.totalPullRequests}` : ""} PRs
                    processed
                  </span>
                </span>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                  {assessment.status.replaceAll("_", " ")}
                </span>
                {RUNNING_STATES.has(assessment.status) && (
                  <span className="text-xs tabular-nums text-slate-500">
                    {assessment.progress}%
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </section>

      {selected && (
        <section aria-live="polite" className="rounded-lg border border-slate-200 bg-white">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div>
              <h2 className="font-semibold text-slate-900">Assessment report</h2>
              <p className="mt-1 text-xs text-slate-500">
                {new Date(selected.windowStart).toLocaleDateString()} –{" "}
                {new Date(selected.windowEnd).toLocaleDateString()}
                {selected.expiresAt &&
                  ` · Expires ${new Date(selected.expiresAt).toLocaleDateString()}`}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {reportReady && (
                <a
                  href={`/api/backend/api/organizations/${encodeURIComponent(organizationId)}/assessments/${encodeURIComponent(selected.id)}/export`}
                  className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <ArrowDownToLine className="h-4 w-4" />
                  Export JSON
                </a>
              )}
              {canManage && cancellable && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void submitAction(
                      `/${selected.id}/cancel`,
                      { method: "POST" },
                      "Cancellation requested.",
                    )
                  }
                  className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  <X className="h-4 w-4" />
                  Cancel
                </button>
              )}
              {canManage && retryable && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void submitAction(
                      `/${selected.id}/retry`,
                      { method: "POST" },
                      "Assessment retry queued.",
                    )
                  }
                  className="inline-flex items-center gap-2 rounded-md bg-orange-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-orange-800 disabled:opacity-50"
                >
                  <RotateCcw className="h-4 w-4" />
                  Retry
                </button>
              )}
              {canManage && !cancellable && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm("Delete this assessment report? This cannot be undone.")) {
                      void submitAction(
                        `/${selected.id}`,
                        { method: "DELETE" },
                        "Assessment report deleted.",
                      );
                    }
                  }}
                  className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  Delete report
                </button>
              )}
            </div>
          </div>

          {RUNNING_STATES.has(selected.status) ? (
            <div className="px-5 py-8">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <LoaderCircle className="h-4 w-4 animate-spin text-orange-700" />
                Processing pull requests — {selected.progress}% complete
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded bg-slate-100">
                <div
                  className="h-full bg-orange-600 transition-all"
                  style={{ width: `${selected.progress}%` }}
                />
              </div>
              {selected.errorMessage && (
                <p className="mt-3 text-sm text-red-700">{selected.errorMessage}</p>
              )}
            </div>
          ) : selected.status === "FAILED" ? (
            <p role="alert" className="px-5 py-6 text-sm text-red-700">
              {selected.errorMessage ?? "Assessment failed."}
            </p>
          ) : reportReady && selectedSummary ? (
            <div className="space-y-6 p-5">
              {reportReadout && (
                <section
                  aria-label="Assessment conclusion"
                  className={`rounded-md border p-4 ${
                    reportReadout["outcome"] === "FINDINGS_DETECTED"
                      ? "border-red-200 bg-red-50 text-red-950"
                      : reportReadout["outcome"] === "ASSESSED"
                        ? "border-sky-200 bg-sky-50 text-sky-950"
                        : "border-amber-200 bg-amber-50 text-amber-950"
                  }`}
                >
                  <p className="text-xs font-semibold uppercase tracking-wide">
                    Assessment conclusion
                  </p>
                  <h3 className="mt-1 font-semibold">{displayValue(reportReadout["headline"])}</h3>
                  <p className="mt-1 text-sm">{displayValue(reportReadout["conclusion"])}</p>
                </section>
              )}
              {selected.status === "COMPLETED_WITH_LIMITATIONS" && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                  The report is complete with limitations. Read the coverage notes before
                  interpreting the results.
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ["Pull requests analysed", selectedSummary["pullRequestsAnalysed"]],
                  [
                    "Highest PR risk",
                    selectedSummary["highestPullRequestRiskScore"] ?? "Not calculable",
                  ],
                  ["Security findings", findings.length],
                  [
                    "Approved on current head",
                    isRecord(selectedSummary["reviewCoverage"])
                      ? `${displayValue(selectedSummary["reviewCoverage"]["percentage"], "Not calculable")}%`
                      : "Not available",
                  ],
                ].map(([label, value]) => (
                  <div
                    key={String(label)}
                    className="rounded-md border border-slate-200 bg-slate-50 p-4"
                  >
                    <p className="text-xs font-medium text-slate-500">{displayValue(label)}</p>
                    <p className="mt-1 text-xl font-semibold text-slate-950">
                      {displayValue(value)}
                    </p>
                  </div>
                ))}
              </div>

              {reportCoverage.length > 0 && (
                <section>
                  <h3 className="font-semibold text-slate-900">Assessment coverage</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    Coverage describes what was checked; it does not certify that a repository is
                    secure.
                  </p>
                  <div className="mt-3 overflow-x-auto rounded-md border border-slate-200">
                    <table className="min-w-[760px] w-full text-left text-sm">
                      <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                        <tr>
                          <th className="px-3 py-2">Area</th>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2">Scope</th>
                          <th className="px-3 py-2">What this means</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reportCoverage.map((item, index) => (
                          <tr key={`${displayValue(item["area"])}-${index}`} className="border-t">
                            <td className="px-3 py-2 font-medium">{displayValue(item["area"])}</td>
                            <td className="px-3 py-2">
                              <span
                                className={`rounded-full px-2 py-1 text-xs font-semibold ${
                                  item["status"] === "ASSESSED"
                                    ? "bg-emerald-100 text-emerald-800"
                                    : item["status"] === "PARTIAL"
                                      ? "bg-amber-100 text-amber-900"
                                      : "bg-slate-100 text-slate-700"
                                }`}
                              >
                                {displayValue(item["status"]).replaceAll("_", " ")}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-slate-600">
                              {displayValue(item["scope"])}
                            </td>
                            <td className="px-3 py-2 text-slate-600">
                              {displayValue(item["detail"])}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              <ReportList title="Recommended next steps" value={recommendedActions} />

              <div>
                <h3 className="font-semibold text-slate-900">Security findings</h3>
                {findings.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-600">
                    {reportReadout?.["outcome"] === "NO_RECENT_PULL_REQUESTS"
                      ? "No pull-request findings could be generated because there were no recent pull requests to analyze. This is not a clean result."
                      : "No findings were returned by the evidence collected. Review coverage and limitations; this is not a guarantee that no risk exists."}
                  </p>
                ) : (
                  <div className="mt-3 overflow-x-auto rounded-md border border-slate-200">
                    <table className="min-w-[700px] w-full text-left text-sm">
                      <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                        <tr>
                          <th className="px-3 py-2">Severity</th>
                          <th className="px-3 py-2">Finding</th>
                          <th className="px-3 py-2">Source</th>
                          <th className="px-3 py-2">Evidence</th>
                        </tr>
                      </thead>
                      <tbody>
                        {findings.map((finding, index) => (
                          <tr
                            key={displayValue(finding["id"], String(index))}
                            className="border-t border-slate-100"
                          >
                            <td className="px-3 py-2 font-semibold">
                              {displayValue(finding["severity"])}
                            </td>
                            <td className="px-3 py-2">
                              {displayValue(finding["title"])}
                              <span className="block text-xs text-slate-500">
                                {displayValue(finding["repository"])} PR #
                                {displayValue(finding["pullRequest"])}
                              </span>
                            </td>
                            <td className="px-3 py-2">{displayValue(finding["provider"])}</td>
                            <td className="px-3 py-2 text-xs">
                              {displayValue(finding["file"], "No file reference")}
                              {finding["line"] ? `:${displayValue(finding["line"])}` : ""}
                              {httpsUrl(finding["evidenceUrl"]) && (
                                <a
                                  className="mt-1 block font-medium text-orange-800 underline"
                                  href={httpsUrl(finding["evidenceUrl"]) ?? undefined}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Open provider alert
                                </a>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <ReportList title="Coverage limitations" value={selectedSummary["limitations"]} />
              <ReportList title="Secret scanning" value={selectedSummary["secretDetection"]} />
              <ReportList title="Branch protection" value={selectedSummary["branchProtection"]} />
              <ReportList title="Dependency evidence" value={selectedSummary["dependencyRisks"]} />
              <ReportList title="AI provenance coverage" value={selectedSummary["aiProvenance"]} />
              <ReportList
                title="Policy decisions"
                value={
                  isRecord(selectedSummary["policyCoverage"])
                    ? selectedSummary["policyCoverage"]["decisions"]
                    : null
                }
              />
              <ReportList title="Risk factors" value={selectedSummary["riskFactors"]} />
              <ReportList title="Security evidence" value={selectedSummary["securityEvidence"]} />
            </div>
          ) : (
            <p className="px-5 py-6 text-sm text-slate-600">
              This assessment has not produced a report. Status:{" "}
              {selected.status.replaceAll("_", " ")}.
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function ReportList({ title, value }: { title: string; value: unknown }) {
  const entries = flattenReportValue(value);
  return (
    <section>
      <h3 className="font-semibold text-slate-900">{title}</h3>
      {entries.length === 0 ? (
        <p className="mt-2 text-sm text-slate-600">No recorded items.</p>
      ) : (
        <ul className="mt-2 space-y-2 text-sm text-slate-700">
          {entries.slice(0, 60).map((entry, index) => (
            <li key={index} className="rounded-md border border-slate-200 px-3 py-2">
              {entry}
            </li>
          ))}
          {entries.length > 60 && (
            <li className="text-xs text-slate-500">
              Showing 60 of {entries.length} report entries; export for the complete report.
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function flattenReportValue(value: unknown, path = ""): string[] {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [path ? `${path}: ${value}` : String(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => flattenReportValue(entry, `${path}[${index + 1}]`));
  }
  if (isRecord(value)) {
    return Object.entries(value).flatMap(([key, entry]) =>
      flattenReportValue(entry, path ? `${path}.${key}` : key),
    );
  }
  return [];
}
