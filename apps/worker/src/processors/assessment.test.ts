import { describe, expect, it } from "vitest";
import type { GitHubPullRequestReview, GitHubPullRequestSummary } from "@ai-sdlc/github";
import type { NormalizedChangeRequest } from "@ai-sdlc/source-control";
import {
  buildAssessmentReadout,
  buildAssessmentRecommendedActions,
  classifyAssessmentProvenance,
  getHighestPullRequestRiskScore,
  isApprovedOnHead,
  isPullRequestInAssessmentWindow,
  isReviewInAssessmentWindow,
  redactAssessmentText,
  summarizeAssessmentProvenance,
  toAssessmentPullRequest,
} from "./assessment.js";

const pullRequest: GitHubPullRequestSummary = {
  id: 1,
  number: 1,
  title: "Test change",
  state: "closed",
  created_at: "2026-10-01T00:00:00.000Z",
  updated_at: "2026-10-12T00:00:00.000Z",
  merged_at: null,
  user: { login: "author" },
  head: { sha: "head-1", ref: "feature" },
  base: { ref: "main" },
  additions: 5,
  deletions: 2,
  changed_files: 1,
};

describe("assessment report helpers", () => {
  it("makes an empty pull-request window an explicit non-clean result", () => {
    const readout = buildAssessmentReadout({
      pullRequestsAnalysed: 0,
      findingCount: 0,
      coverage: [
        {
          area: "Pull-request activity",
          status: "NOT_RUN",
          scope: "0 pull requests",
          detail: "No PRs were available.",
        },
      ],
    });

    expect(readout.outcome).toBe("NO_RECENT_PULL_REQUESTS");
    expect(readout.conclusion).toContain("Empty findings do not mean");
  });

  it("distinguishes findings, incomplete coverage, and assessed results", () => {
    const coverage = [
      {
        area: "Secret scanning",
        status: "NOT_RUN" as const,
        scope: "0/1 repositories",
        detail: "Not available.",
      },
    ];
    expect(
      buildAssessmentReadout({
        pullRequestsAnalysed: 1,
        findingCount: 1,
        coverage,
      }).outcome,
    ).toBe("FINDINGS_DETECTED");
    expect(
      buildAssessmentReadout({
        pullRequestsAnalysed: 1,
        findingCount: 0,
        coverage,
      }).outcome,
    ).toBe("LIMITED_COVERAGE");
    const completeCoverage = [
      {
        area: "Secret scanning",
        status: "ASSESSED" as const,
        scope: "1/1 repositories",
        detail: "Collected.",
      },
    ];
    expect(
      buildAssessmentReadout({
        pullRequestsAnalysed: 1,
        findingCount: 0,
        coverage: completeCoverage,
      }).outcome,
    ).toBe("ASSESSED");
  });

  it("provides useful next steps for no-PR and unavailable coverage results", () => {
    const actions = buildAssessmentRecommendedActions({
      pullRequestsAnalysed: 0,
      findings: [],
      coverage: [
        {
          area: "Pull-request activity",
          status: "NOT_RUN",
          scope: "0 pull requests",
          detail: "No PRs were available.",
        },
        {
          area: "Secret scanning",
          status: "NOT_RUN",
          scope: "0/1 repositories",
          detail: "Not available.",
        },
        {
          area: "GitHub Code Scanning alerts",
          status: "NOT_RUN",
          scope: "0/1 repositories",
          detail: "Not available.",
        },
        {
          area: "GitHub Dependabot alerts",
          status: "NOT_RUN",
          scope: "0/1 repositories",
          detail: "Not available.",
        },
      ],
    });

    expect(actions.some((action) => action.action.includes("Open or update a pull request"))).toBe(
      true,
    );
    expect(
      actions.some((action) => action.action.includes("Enable the provider's secret scanning")),
    ).toBe(true);
    expect(actions.some((action) => action.action.includes("Code scanning alerts: read"))).toBe(
      true,
    );
    expect(actions.some((action) => action.action.includes("Dependabot alerts: read"))).toBe(true);
  });

  it("accepts persisted classifications and defaults unsupported values to unknown", () => {
    expect(classifyAssessmentProvenance("OBSERVED")).toBe("OBSERVED");
    expect(classifyAssessmentProvenance("DECLARED")).toBe("DECLARED");
    expect(classifyAssessmentProvenance("INFERRED")).toBe("INFERRED");
    expect(classifyAssessmentProvenance("GIT_METADATA")).toBe("UNKNOWN");
    expect(classifyAssessmentProvenance(undefined)).toBe("UNKNOWN");
  });

  it("aggregates first-class signals against the full PR denominator with traceable evidence", () => {
    const summary = summarizeAssessmentProvenance([
      {
        number: 1,
        headSha: "head-1",
        repository: { owner: "acme", name: "service" },
        provenanceSignals: [
          {
            headSha: "head-1",
            classification: "OBSERVED",
            verificationStatus: "VERIFIED",
            signalSource: "GITHUB_BOT_AUTHOR",
            signalType: "KNOWN_AI_BOT_AUTHOR",
            evidenceReference: "github:pull-request:123",
            evidenceAt: new Date("2026-10-12T00:00:00.000Z"),
            confidence: 0.95,
            limitations: "Does not prove all change content was AI-authored.",
          },
        ],
      },
      {
        number: 2,
        headSha: "head-2",
        repository: { owner: "acme", name: "service" },
        provenanceSignals: [],
      },
    ]);

    expect(summary.classifications).toEqual({
      OBSERVED: 1,
      DECLARED: 0,
      INFERRED: 0,
      UNKNOWN: 1,
    });
    expect(summary.coverage).toEqual({
      denominator: 2,
      currentHeadSignals: 1,
      percentage: 50,
    });
    expect(summary.records).toEqual([
      {
        repository: "acme/service",
        pullRequest: 1,
        headSha: "head-1",
        classification: "OBSERVED",
        verificationStatus: "VERIFIED",
        signalSource: "GITHUB_BOT_AUTHOR",
        signalType: "KNOWN_AI_BOT_AUTHOR",
        evidenceReference: "github:pull-request:123",
        evidenceAt: "2026-10-12T00:00:00.000Z",
        confidence: 0.95,
        limitations: "Does not prove all change content was AI-authored.",
      },
      {
        repository: "acme/service",
        pullRequest: 2,
        headSha: "head-2",
        classification: "UNKNOWN",
        verificationStatus: null,
        signalSource: null,
        signalType: null,
        evidenceReference: null,
        evidenceAt: null,
        confidence: null,
        limitations: null,
      },
    ]);
  });

  it("excludes stale-head provenance and out-of-range confidence from assessed classifications", () => {
    const summary = summarizeAssessmentProvenance([
      {
        number: 7,
        headSha: "new-head",
        repository: { owner: "acme", name: "service" },
        provenanceSignals: [
          {
            headSha: "old-head",
            classification: "OBSERVED",
            verificationStatus: "VERIFIED",
            signalSource: "GITHUB",
            signalType: "KNOWN_AI_BOT_AUTHOR",
            evidenceReference: "github:pull-request:7",
            evidenceAt: new Date("2026-10-12T00:00:00.000Z"),
            confidence: 0.99,
            limitations: null,
          },
        ],
      },
      {
        number: 8,
        headSha: "current-head",
        repository: { owner: "acme", name: "service" },
        provenanceSignals: [
          {
            headSha: "current-head",
            classification: "DECLARED",
            verificationStatus: "UNVERIFIED",
            signalSource: "GITHUB",
            signalType: "DECLARED_PULL_REQUEST_TEXT",
            evidenceReference: "github:pull-request:8",
            evidenceAt: new Date("2026-10-12T00:00:00.000Z"),
            confidence: 1.5,
            limitations: null,
          },
        ],
      },
    ]);

    expect(summary.classifications.UNKNOWN).toBe(2);
    expect(summary.coverage).toMatchObject({
      denominator: 2,
      currentHeadSignals: 1,
      percentage: 50,
    });
    expect(summary.records[0]?.classification).toBe("UNKNOWN");
    expect(summary.records[1]).toMatchObject({
      classification: "UNKNOWN",
      confidence: null,
      limitations: "The recorded confidence was outside the valid 0-1 range and was excluded.",
    });
  });

  it("normalizes GitLab merge-request identity and metadata for the shared analyzer", () => {
    const mergeRequest: NormalizedChangeRequest = {
      provider: "GITLAB",
      externalId: "991",
      number: 17,
      title: "Fix access control",
      state: "MERGED",
      author: "developer",
      sourceBranch: "fix/access",
      targetBranch: "main",
      headSha: "head-sha",
      additions: null,
      deletions: null,
      changedFilesCount: 2,
      createdAt: "2026-10-01T10:00:00Z",
      updatedAt: "2026-10-02T10:00:00Z",
      mergedAt: "2026-10-02T11:00:00Z",
      webUrl: "https://gitlab.com/acme/service/-/merge_requests/17",
      original: {
        provider: "GITLAB",
        externalId: "42!17",
        url: "https://gitlab.com/acme/service/-/merge_requests/17",
        collectedAt: "2026-10-02T12:00:00Z",
      },
    };

    expect(toAssessmentPullRequest(mergeRequest)).toEqual({
      id: 991,
      number: 17,
      title: "Fix access control",
      state: "merged",
      created_at: "2026-10-01T10:00:00Z",
      updated_at: "2026-10-02T10:00:00Z",
      merged_at: "2026-10-02T11:00:00Z",
      user: { login: "developer" },
      head: { sha: "head-sha", ref: "fix/access" },
      base: { ref: "main" },
      additions: 0,
      deletions: 0,
      changed_files: 2,
    });
  });

  it("rejects malformed provider change-request identifiers", () => {
    const mergeRequest: NormalizedChangeRequest = {
      provider: "GITLAB",
      externalId: "invalid",
      number: 1,
      title: "Invalid external id",
      state: "OPEN",
      author: null,
      sourceBranch: null,
      targetBranch: null,
      headSha: null,
      additions: null,
      deletions: null,
      changedFilesCount: null,
      createdAt: "2026-10-01T10:00:00Z",
      updatedAt: "2026-10-01T10:00:00Z",
      mergedAt: null,
      webUrl: "https://gitlab.com/acme/service/-/merge_requests/1",
      original: {
        provider: "GITLAB",
        externalId: "project!1",
        collectedAt: "2026-10-01T10:00:00Z",
      },
    };
    expect(() => toAssessmentPullRequest(mergeRequest)).toThrow(
      "GITLAB returned a change request with an invalid external ID.",
    );
  });

  it("normalizes Bitbucket change-request identifiers for the shared assessment pipeline", () => {
    const bitbucketRequest: NormalizedChangeRequest = {
      provider: "BITBUCKET",
      externalId: "17",
      number: 17,
      title: "Fix authorization",
      state: "MERGED",
      author: "developer",
      sourceBranch: "fix/auth",
      targetBranch: "main",
      headSha: "head-sha",
      additions: 4,
      deletions: 1,
      changedFilesCount: 1,
      createdAt: "2026-10-01T10:00:00Z",
      updatedAt: "2026-10-02T10:00:00Z",
      mergedAt: "2026-10-02T11:00:00Z",
      webUrl: "https://bitbucket.org/acme/service/pull-requests/17",
      original: {
        provider: "BITBUCKET",
        externalId: "17",
        collectedAt: "2026-10-02T12:00:00Z",
      },
    };

    expect(toAssessmentPullRequest(bitbucketRequest)).toMatchObject({
      id: 17,
      number: 17,
      state: "merged",
      head: { sha: "head-sha", ref: "fix/auth" },
      base: { ref: "main" },
      additions: 4,
      deletions: 1,
      changed_files: 1,
    });
  });

  it("redacts credential-like values from report text", () => {
    expect(redactAssessmentText("exposed ghp_abcdefghijklmnopqrstuvwxyz123456")).toBe(
      "exposed [REDACTED]",
    );
    expect(redactAssessmentText("api_key=topsecretvalue")).toBe("[REDACTED]");
  });

  it("selects PRs updated within the fixed period and rejects invalid or future dates", () => {
    const from = new Date("2026-09-13T00:00:00.000Z");
    const to = new Date("2026-10-13T00:00:00.000Z");
    expect(isPullRequestInAssessmentWindow(pullRequest, from, to)).toBe(true);
    expect(isPullRequestInAssessmentWindow({ ...pullRequest, updated_at: "bad" }, from, to)).toBe(
      false,
    );
    expect(
      isPullRequestInAssessmentWindow(
        { ...pullRequest, updated_at: "2026-10-14T00:00:00.000Z" },
        from,
        to,
      ),
    ).toBe(false);
  });

  it("counts approval only when it applies to the current known head", () => {
    const reviews: GitHubPullRequestReview[] = [
      {
        id: 1,
        user: { login: "reviewer" },
        state: "APPROVED",
        submitted_at: null,
        commit_id: "head-1",
      },
      {
        id: 2,
        user: { login: "reviewer" },
        state: "APPROVED",
        submitted_at: null,
        commit_id: "old-head",
      },
    ];
    expect(isApprovedOnHead(reviews, "head-1")).toBe(true);
    expect(isApprovedOnHead(reviews, "missing-head")).toBe(false);
    expect(isApprovedOnHead(reviews, null)).toBe(false);
  });

  it("includes only submitted review events in the assessment period", () => {
    const review: GitHubPullRequestReview = {
      id: 1,
      user: { login: "reviewer" },
      state: "APPROVED",
      submitted_at: "2026-10-01T12:00:00.000Z",
      commit_id: "head-1",
    };
    expect(
      isReviewInAssessmentWindow(
        review,
        new Date("2026-09-13T00:00:00.000Z"),
        new Date("2026-10-13T00:00:00.000Z"),
      ),
    ).toBe(true);
    expect(
      isReviewInAssessmentWindow(
        { ...review, submitted_at: "2026-09-12T23:59:59.000Z" },
        new Date("2026-09-13T00:00:00.000Z"),
        new Date("2026-10-13T00:00:00.000Z"),
      ),
    ).toBe(false);
  });

  it("uses the highest actual persisted risk score and does not invent an empty score", () => {
    expect(getHighestPullRequestRiskScore([{ score: 14 }, { score: 67 }, { score: 29 }])).toBe(67);
    expect(getHighestPullRequestRiskScore([])).toBeNull();
  });
});
