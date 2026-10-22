import type { Hono } from "hono";
import { prisma } from "@ai-sdlc/db";
import { requireAuth, requireOrganizationRole } from "../middleware/auth.js";
import type { AppEnv } from "../types.js";

type DailyCount = { day: string; count: number };
type GovernanceAnalyticsData = {
  days: 7 | 30 | 90;
  periodStart: string;
  openFindings: number;
  openFindingsBySeverity: Record<string, number>;
  overdueFindings: number;
  activeRiskAcceptances: number;
  expiredRiskAcceptances: number;
  resolvedFindings: number;
  averageRemediationDays: number | null;
  completedReviews: number;
  reviewApprovalRate: number | null;
  newPullRequests: number;
  enabledRepositories: number;
  recentlyAssessedRepositories: number;
  repositoryAssessmentCoveragePercent: number | null;
  pullRequestsInPeriod: number;
  analyzedPullRequests: number;
  changeAnalysisCoveragePercent: number | null;
  unknownProvenancePullRequests: number;
  provenanceUnknownPercent: number | null;
  connectedSourceControlIntegrations: number;
  disconnectedSourceControlIntegrations: number;
  policyDecisionsByAction: Record<string, number>;
  failedSecurityGates: number;
  evidenceByStatus: Record<string, number>;
  notificationEmailStatuses: Record<string, number>;
  pullRequestsWithPassports: number;
  passportAvailabilityPercent: number | null;
  trends: {
    pullRequests: DailyCount[];
    reviewsCompleted: DailyCount[];
    findingsResolved: DailyCount[];
  };
};

const CLOSED_FINDING_STATUSES = ["RESOLVED", "ACCEPTED", "FALSE_POSITIVE"];

function parseDays(rawDays: string | undefined): 7 | 30 | 90 | null {
  switch (rawDays ?? "30") {
    case "7":
      return 7;
    case "30":
      return 30;
    case "90":
      return 90;
    default:
      return null;
  }
}

function buildDailySeries(start: Date, days: number, rows: DailyCount[]): DailyCount[] {
  const counts = new Map(rows.map((row) => [row.day, row.count]));
  return Array.from({ length: days }, (_, index) => {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + index);
    const key = day.toISOString().slice(0, 10);
    return { day: key, count: counts.get(key) ?? 0 };
  });
}

async function dailyCounts(
  table: "PullRequest" | "Review" | "SecurityFinding",
  organizationId: string,
  start: Date,
): Promise<DailyCount[]> {
  switch (table) {
    case "PullRequest":
      return prisma.$queryRaw<DailyCount[]>`
      SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
             COUNT(*)::int AS count
      FROM "PullRequest"
      WHERE "organizationId" = ${organizationId} AND "createdAt" >= ${start}
      GROUP BY 1 ORDER BY 1
    `;
    case "Review":
      return prisma.$queryRaw<DailyCount[]>`
      SELECT to_char(date_trunc('day', "completedAt"), 'YYYY-MM-DD') AS day,
             COUNT(*)::int AS count
      FROM "Review"
      WHERE "organizationId" = ${organizationId} AND "completedAt" >= ${start}
      GROUP BY 1 ORDER BY 1
    `;
    case "SecurityFinding":
      return prisma.$queryRaw<DailyCount[]>`
      SELECT to_char(date_trunc('day', "resolvedAt"), 'YYYY-MM-DD') AS day,
             COUNT(*)::int AS count
      FROM "SecurityFinding"
      WHERE "organizationId" = ${organizationId} AND "resolvedAt" >= ${start}
        AND "status" = 'RESOLVED'
      GROUP BY 1 ORDER BY 1
    `;
  }
}

async function loadGovernanceAnalytics(
  organizationId: string,
  days: 7 | 30 | 90,
): Promise<GovernanceAnalyticsData> {
  const today = new Date();
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - (days - 1));

  const [
    pullRequestRows,
    reviewRows,
    findingRows,
    findingGroups,
    remediationTime,
    overdueFindings,
    activeRiskAcceptances,
    expiredRiskAcceptances,
    enabledRepositories,
    recentlyAssessedRepositoryRows,
    pullRequestCoverageRows,
    unknownProvenanceRows,
    connectedSourceControlIntegrations,
    disconnectedSourceControlIntegrations,
    policyDecisionGroups,
    evidenceGroups,
    notificationEmailGroups,
    passportCoverageRows,
  ] = await Promise.all([
    dailyCounts("PullRequest", organizationId, start),
    dailyCounts("Review", organizationId, start),
    dailyCounts("SecurityFinding", organizationId, start),
    prisma.securityFinding.groupBy({
      by: ["status", "severity"],
      where: { organizationId, status: { notIn: CLOSED_FINDING_STATUSES } },
      _count: { _all: true },
    }),
    prisma.$queryRaw<Array<{ averageDays: number | null }>>`
      SELECT AVG(EXTRACT(EPOCH FROM ("resolvedAt" - "createdAt")) / 86400.0)::float AS "averageDays"
      FROM "SecurityFinding"
      WHERE "organizationId" = ${organizationId}
        AND "resolvedAt" >= ${start}
        AND "status" = 'RESOLVED'
    `,
    prisma.securityFinding.count({
      where: {
        organizationId,
        dueAt: { lt: today },
        status: { notIn: CLOSED_FINDING_STATUSES },
      },
    }),
    prisma.riskAcceptance.count({
      where: {
        organizationId,
        status: "ACCEPTED",
        OR: [{ expiresAt: null }, { expiresAt: { gte: today } }],
      },
    }),
    prisma.riskAcceptance.count({
      where: {
        organizationId,
        status: "ACCEPTED",
        expiresAt: { lt: today },
      },
    }),
    prisma.repository.count({ where: { organizationId, enabled: true } }),
    prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(DISTINCT ar."repositoryId")::int AS count
      FROM "AssessmentRepository" ar
      INNER JOIN "Assessment" a ON a."id" = ar."assessmentId"
      INNER JOIN "Repository" r ON r."id" = ar."repositoryId"
      WHERE a."organizationId" = ${organizationId}
        AND a."status" IN ('COMPLETED', 'COMPLETED_WITH_LIMITATIONS')
        AND a."completedAt" >= ${start}
        AND r."enabled" = TRUE
    `,
    prisma.$queryRaw<Array<{ total: number; analyzed: number }>>`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (
               WHERE pr."headSha" IS NOT NULL AND pr."lastAnalyzedSha" = pr."headSha"
             )::int AS analyzed
      FROM "PullRequest" pr
      WHERE pr."organizationId" = ${organizationId}
        AND pr."createdAt" >= ${start}
    `,
    prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM (
        SELECT DISTINCT ON (activity."pullRequestId")
               activity."pullRequestId", activity."involvement"
        FROM "AIActivity" activity
        INNER JOIN "PullRequest" pr ON pr."id" = activity."pullRequestId"
        WHERE activity."organizationId" = ${organizationId}
          AND activity."pullRequestId" IS NOT NULL
          AND pr."createdAt" >= ${start}
          AND pr."headSha" IS NOT NULL
          AND pr."lastAnalyzedSha" = pr."headSha"
        ORDER BY activity."pullRequestId", activity."createdAt" DESC, activity."id" DESC
      ) latest
      WHERE latest."involvement" = 'UNKNOWN'
    `,
    prisma.sourceControlConnection.count({
      where: { organizationId, active: true, revokedAt: null },
    }),
    prisma.sourceControlConnection.count({
      where: { organizationId, OR: [{ active: false }, { revokedAt: { not: null } }] },
    }),
    prisma.policyDecision.groupBy({
      by: ["action"],
      where: { organizationId, createdAt: { gte: start } },
      _count: { _all: true },
    }),
    prisma.evidence.groupBy({
      by: ["status"],
      where: { organizationId, createdAt: { gte: start } },
      _count: { _all: true },
    }),
    prisma.notification.groupBy({
      by: ["emailStatus"],
      where: { organizationId, createdAt: { gte: start } },
      _count: { _all: true },
    }),
    prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(DISTINCT cp."pullRequestId")::int AS count
      FROM "ChangePassport" cp
      INNER JOIN "PullRequest" pr ON pr."id" = cp."pullRequestId"
      WHERE cp."organizationId" = ${organizationId}
        AND cp."pullRequestId" IS NOT NULL
        AND pr."createdAt" >= ${start}
    `,
  ]);

  const openFindings = findingGroups.reduce((total, item) => total + item._count._all, 0);
  const openBySeverity = findingGroups.reduce<Record<string, number>>((result, item) => {
    result[item.severity] = (result[item.severity] ?? 0) + item._count._all;
    return result;
  }, {});
  const completedReviewCount = reviewRows.reduce((total, item) => total + item.count, 0);
  const approvals = await prisma.review.count({
    where: {
      organizationId,
      completedAt: { gte: start },
      decision: "APPROVED",
    },
  });
  const recentlyAssessedRepositories = recentlyAssessedRepositoryRows[0]?.count ?? 0;
  const pullRequestCount = pullRequestCoverageRows[0]?.total ?? 0;
  const analyzedPullRequestCount = pullRequestCoverageRows[0]?.analyzed ?? 0;
  const unknownProvenancePullRequests = unknownProvenanceRows[0]?.count ?? 0;
  const policyDecisionsByAction = Object.fromEntries(
    policyDecisionGroups.map((group) => [group.action, group._count._all]),
  );
  const evidenceByStatus = Object.fromEntries(
    evidenceGroups.map((group) => [group.status, group._count._all]),
  );
  const notificationEmailStatuses = Object.fromEntries(
    notificationEmailGroups.map((group) => [group.emailStatus, group._count._all]),
  );
  const pullRequestsWithPassports = passportCoverageRows[0]?.count ?? 0;

  return {
    days,
    periodStart: start.toISOString(),
    openFindings,
    openFindingsBySeverity: openBySeverity,
    overdueFindings,
    activeRiskAcceptances,
    expiredRiskAcceptances,
    resolvedFindings: findingRows.reduce((total, item) => total + item.count, 0),
    averageRemediationDays: remediationTime[0]?.averageDays ?? null,
    completedReviews: completedReviewCount,
    reviewApprovalRate:
      completedReviewCount === 0 ? null : Math.round((approvals / completedReviewCount) * 100),
    newPullRequests: pullRequestRows.reduce((total, item) => total + item.count, 0),
    enabledRepositories,
    recentlyAssessedRepositories,
    repositoryAssessmentCoveragePercent:
      enabledRepositories === 0
        ? null
        : Math.round((recentlyAssessedRepositories / enabledRepositories) * 100),
    pullRequestsInPeriod: pullRequestCount,
    analyzedPullRequests: analyzedPullRequestCount,
    changeAnalysisCoveragePercent:
      pullRequestCount === 0
        ? null
        : Math.round((analyzedPullRequestCount / pullRequestCount) * 100),
    unknownProvenancePullRequests,
    provenanceUnknownPercent:
      analyzedPullRequestCount === 0
        ? null
        : Math.round((unknownProvenancePullRequests / analyzedPullRequestCount) * 100),
    connectedSourceControlIntegrations,
    disconnectedSourceControlIntegrations,
    policyDecisionsByAction,
    failedSecurityGates: policyDecisionsByAction["BLOCK"] ?? 0,
    evidenceByStatus,
    notificationEmailStatuses,
    pullRequestsWithPassports,
    passportAvailabilityPercent:
      pullRequestCount === 0
        ? null
        : Math.round((pullRequestsWithPassports / pullRequestCount) * 100),
    trends: {
      pullRequests: buildDailySeries(start, days, pullRequestRows),
      reviewsCompleted: buildDailySeries(start, days, reviewRows),
      findingsResolved: buildDailySeries(start, days, findingRows),
    },
  };
}

function csvCell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

function toGovernanceCsv(analytics: GovernanceAnalyticsData): string {
  const rows: Array<Array<string | number | null>> = [
    ["Section", "Metric", "Date (UTC)", "Value"],
    ["Metadata", "Reporting period in days", null, analytics.days],
    ["Metadata", "Period start (UTC)", null, analytics.periodStart],
    ["Current backlog", "Open findings", null, analytics.openFindings],
    ["Current backlog", "Overdue findings", null, analytics.overdueFindings],
    ["Risk acceptance", "Active", null, analytics.activeRiskAcceptances],
    ["Risk acceptance", "Expired", null, analytics.expiredRiskAcceptances],
    ["Period", "Findings resolved", null, analytics.resolvedFindings],
    [
      "Period",
      "Average remediation days",
      null,
      analytics.averageRemediationDays === null
        ? "Not available"
        : analytics.averageRemediationDays,
    ],
    ["Period", "Reviews completed", null, analytics.completedReviews],
    [
      "Period",
      "Review approval rate (%)",
      null,
      analytics.reviewApprovalRate === null ? "Not available" : analytics.reviewApprovalRate,
    ],
    ["Period", "New pull requests", null, analytics.newPullRequests],
    ["Coverage", "Enabled repositories", null, analytics.enabledRepositories],
    ["Coverage", "Repositories assessed in period", null, analytics.recentlyAssessedRepositories],
    [
      "Coverage",
      "Repository assessment coverage (%)",
      null,
      analytics.repositoryAssessmentCoveragePercent ?? "Not available",
    ],
    ["Coverage", "Pull requests created in period", null, analytics.pullRequestsInPeriod],
    ["Coverage", "Current-head analyzed pull requests", null, analytics.analyzedPullRequests],
    [
      "Coverage",
      "Current-head analysis coverage (%)",
      null,
      analytics.changeAnalysisCoveragePercent ?? "Not available",
    ],
    [
      "Provenance",
      "Analyzed pull requests with UNKNOWN provenance",
      null,
      analytics.unknownProvenancePullRequests,
    ],
    [
      "Provenance",
      "UNKNOWN provenance among analyzed pull requests (%)",
      null,
      analytics.provenanceUnknownPercent ?? "Not available",
    ],
    [
      "Integrations",
      "Active source-control connections",
      null,
      analytics.connectedSourceControlIntegrations,
    ],
    [
      "Integrations",
      "Disconnected or revoked source-control connections",
      null,
      analytics.disconnectedSourceControlIntegrations,
    ],
    ["Policy", "Persisted decisions with BLOCK action", null, analytics.failedSecurityGates],
    ["Change Passport", "Pull requests with a passport", null, analytics.pullRequestsWithPassports],
    [
      "Change Passport",
      "Passport availability among pull requests in period (%)",
      null,
      analytics.passportAvailabilityPercent ?? "Not available",
    ],
  ];

  for (const [action, count] of Object.entries(analytics.policyDecisionsByAction).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    rows.push(["Policy decisions in period", action, null, count]);
  }
  for (const [status, count] of Object.entries(analytics.evidenceByStatus).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    rows.push(["Evidence records in period", status, null, count]);
  }
  for (const [status, count] of Object.entries(analytics.notificationEmailStatuses).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    rows.push(["Notification email status in period", status, null, count]);
  }
  for (const [severity, count] of Object.entries(analytics.openFindingsBySeverity).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    rows.push(["Current backlog by severity", severity, null, count]);
  }

  const trendGroups = [
    ["Pull requests", analytics.trends.pullRequests],
    ["Reviews completed", analytics.trends.reviewsCompleted],
    ["Findings resolved", analytics.trends.findingsResolved],
  ] as const;
  const dailyValues = new Map<string, Record<string, number>>();
  for (const [metric, trend] of trendGroups) {
    for (const item of trend) {
      const values = dailyValues.get(item.day) ?? {};
      values[metric] = item.count;
      dailyValues.set(item.day, values);
    }
  }
  for (const [day, values] of [...dailyValues.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    for (const [metric] of trendGroups) {
      rows.push(["Daily trend", metric, day, values[metric] ?? 0]);
    }
  }

  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function registerGovernanceAnalyticsRoutes(app: Hono<AppEnv>): void {
  app.get(
    "/api/organizations/:organizationId/governance-analytics",
    requireAuth,
    requireOrganizationRole("VIEWER"),
    async (c) => {
      const days = parseDays(c.req.query("days"));
      if (days === null) {
        return c.json(
          {
            data: null,
            error: { code: "VALIDATION_ERROR", message: "days must be 7, 30, or 90" },
          },
          400,
        );
      }
      const data = await loadGovernanceAnalytics(c.get("organizationId"), days);
      return c.json({ data, error: null });
    },
  );

  app.get(
    "/api/organizations/:organizationId/governance-analytics/export",
    requireAuth,
    requireOrganizationRole("VIEWER"),
    async (c) => {
      const days = parseDays(c.req.query("days"));
      if (days === null) {
        return c.json(
          {
            data: null,
            error: { code: "VALIDATION_ERROR", message: "days must be 7, 30, or 90" },
          },
          400,
        );
      }

      const data = await loadGovernanceAnalytics(c.get("organizationId"), days);
      c.header("Content-Type", "text/csv; charset=utf-8");
      c.header(
        "Content-Disposition",
        `attachment; filename="nomalog-governance-analytics-${days}-days.csv"`,
      );
      c.header("Cache-Control", "private, no-store");
      return c.body(toGovernanceCsv(data));
    },
  );
}
