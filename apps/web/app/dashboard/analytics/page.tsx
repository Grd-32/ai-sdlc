import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getGovernanceAnalytics, getOrganizations, getSelectedOrganization } from "@/lib/api";

const RANGES = [7, 30, 90] as const;

export default async function GovernanceAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const params = await searchParams;
  const parsedDays = Number(params.days ?? "30");
  const days = RANGES.includes(parsedDays as (typeof RANGES)[number])
    ? (parsedDays as (typeof RANGES)[number])
    : 30;
  const organizations = await getOrganizations();
  const organization = await getSelectedOrganization(organizations);
  if (!organization) return null;

  const analytics = await getGovernanceAnalytics(organization.id, days);
  const metrics = analytics
    ? [
        { label: "Open findings", value: analytics.openFindings, href: "/dashboard/findings" },
        {
          label: "Overdue findings",
          value: analytics.overdueFindings,
          href: "/dashboard/findings?overdue=true",
        },
        {
          label: "Expired risk acceptances",
          value: analytics.expiredRiskAcceptances,
          href: "/dashboard/findings?status=ACCEPTED",
        },
        {
          label: "Active risk acceptances",
          value: analytics.activeRiskAcceptances,
          href: "/dashboard/findings?status=ACCEPTED",
        },
        {
          label: `Resolved in ${days} days`,
          value: analytics.resolvedFindings,
          href: "/dashboard/findings",
        },
        {
          label: `Average remediation time`,
          value:
            analytics.averageRemediationDays === null
              ? "—"
              : `${analytics.averageRemediationDays.toFixed(1)} days`,
          href: "/dashboard/findings",
        },
        {
          label: `Reviews completed`,
          value: analytics.completedReviews,
          href: "/dashboard/changes",
        },
        {
          label: "Review approval rate",
          value: analytics.reviewApprovalRate === null ? "—" : `${analytics.reviewApprovalRate}%`,
          href: "/dashboard/changes",
        },
        {
          label: `New pull requests`,
          value: analytics.newPullRequests,
          href: "/dashboard/changes",
        },
        {
          label: `Repository assessment coverage (${days}d)`,
          value:
            analytics.repositoryAssessmentCoveragePercent === null
              ? `${analytics.recentlyAssessedRepositories}/${analytics.enabledRepositories} · —`
              : `${analytics.recentlyAssessedRepositories}/${analytics.enabledRepositories} · ${analytics.repositoryAssessmentCoveragePercent}%`,
          href: "/dashboard/repositories",
        },
        {
          label: `Current-head analysis coverage (${days}d)`,
          value:
            analytics.changeAnalysisCoveragePercent === null
              ? `${analytics.analyzedPullRequests}/${analytics.pullRequestsInPeriod} · —`
              : `${analytics.analyzedPullRequests}/${analytics.pullRequestsInPeriod} · ${analytics.changeAnalysisCoveragePercent}%`,
          href: "/dashboard/changes",
        },
        {
          label: "Unknown provenance among analyzed changes",
          value:
            analytics.provenanceUnknownPercent === null
              ? `${analytics.unknownProvenancePullRequests}/${analytics.analyzedPullRequests} · —`
              : `${analytics.unknownProvenancePullRequests}/${analytics.analyzedPullRequests} · ${analytics.provenanceUnknownPercent}%`,
          href: "/dashboard/changes",
        },
        {
          label: "Active source-control connections",
          value: analytics.connectedSourceControlIntegrations,
          href: "/dashboard/repositories",
        },
        {
          label: "Disconnected or revoked connections",
          value: analytics.disconnectedSourceControlIntegrations,
          href: "/dashboard/repositories",
        },
        {
          label: `Policy BLOCK decisions (${days}d)`,
          value: analytics.failedSecurityGates,
          href: "/dashboard/policies",
        },
        {
          label: `Change Passport coverage (${days}d)`,
          value:
            analytics.passportAvailabilityPercent === null
              ? `${analytics.pullRequestsWithPassports}/${analytics.pullRequestsInPeriod} · —`
              : `${analytics.pullRequestsWithPassports}/${analytics.pullRequestsInPeriod} · ${analytics.passportAvailabilityPercent}%`,
          href: "/dashboard/changes",
        },
        {
          label: `Evidence outcomes (${days}d)`,
          value: `PASS ${analytics.evidenceByStatus["PASS"] ?? 0} · FAIL ${analytics.evidenceByStatus["FAIL"] ?? 0} · UNKNOWN ${analytics.evidenceByStatus["UNKNOWN"] ?? 0} · NOT RUN ${analytics.evidenceByStatus["NOT_RUN"] ?? 0}`,
          href: "/dashboard/evidence",
        },
        {
          label: `Email provider failures (${days}d)`,
          value: analytics.notificationEmailStatuses["FAILED"] ?? 0,
          href: "/dashboard/notifications",
        },
      ]
    : [];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            Governance
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">Analytics</h1>
          <p className="mt-1 text-sm text-slate-600">
            {organization.name} · rolling activity and current backlog
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <nav aria-label="Analytics date range" className="flex gap-2">
            {RANGES.map((range) => (
              <Link
                key={range}
                href={`/dashboard/analytics?days=${range}`}
                aria-current={days === range ? "page" : undefined}
                className={`rounded-md border px-3 py-2 text-sm font-medium ${
                  days === range
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {range} days
              </Link>
            ))}
          </nav>
          <a
            href={`/api/backend/api/organizations/${encodeURIComponent(organization.id)}/governance-analytics/export?days=${days}`}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Download CSV
          </a>
        </div>
      </header>

      {!analytics ? (
        <p
          role="status"
          className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
        >
          Governance analytics could not be loaded. Refresh the page or check the API service.
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {metrics.map((metric) => (
              <Link key={metric.label} href={metric.href}>
                <Card className="h-full transition-colors hover:border-slate-300">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-medium text-slate-600">
                      {metric.label}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-semibold tabular-nums text-slate-950">
                      {metric.value}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
          <p className="text-xs text-slate-500">
            Policy BLOCK counts persisted decisions and does not prove provider-side merge
            enforcement. Email SENT counts provider acceptance, not confirmed delivery. Evidence
            statuses are records, not distinct changes or a scan pass rate.
          </p>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Current finding backlog</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              {Object.entries(analytics.openFindingsBySeverity).length === 0 ? (
                <p className="text-sm text-slate-500">No open findings.</p>
              ) : (
                Object.entries(analytics.openFindingsBySeverity)
                  .sort(([left], [right]) => left.localeCompare(right))
                  .map(([severity, count]) => (
                    <Link
                      key={severity}
                      href={`/dashboard/findings?severity=${encodeURIComponent(severity)}`}
                      className="rounded-lg border border-slate-200 px-4 py-3 hover:bg-slate-50"
                    >
                      <span className="block text-xs font-semibold uppercase text-slate-500">
                        {severity}
                      </span>
                      <span className="mt-1 block text-2xl font-semibold text-slate-900">
                        {count}
                      </span>
                    </Link>
                  ))
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-3">
            <TrendCard title="New pull requests" values={analytics.trends.pullRequests} />
            <TrendCard title="Reviews completed" values={analytics.trends.reviewsCompleted} />
            <TrendCard title="Findings resolved" values={analytics.trends.findingsResolved} />
          </div>
          <p className="text-xs text-slate-500">
            Trends use UTC calendar days. Open and overdue findings reflect the current backlog;
            other metrics are limited to the selected rolling period. Repository assessment coverage
            is completed assessments in the period divided by enabled repositories. Current-head
            analysis coverage is analyzed current heads divided by pull requests created in the
            period. Unknown provenance is counted among those analyzed pull requests; UNKNOWN means
            available evidence did not confirm AI use, not that AI was not used.
          </p>
        </>
      )}
    </div>
  );
}

function TrendCard({
  title,
  values,
}: {
  title: string;
  values: Array<{ day: string; count: number }>;
}) {
  const max = Math.max(...values.map((item) => item.count), 1);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          role="img"
          aria-label={`${title} by day for the selected period`}
          className="flex h-32 items-end gap-1 border-b border-l border-slate-200 px-1"
        >
          {values.map((item) => (
            <div
              key={item.day}
              title={`${item.day}: ${item.count}`}
              className="flex h-full min-w-0 flex-1 items-end"
            >
              <span
                className="block w-full rounded-t-sm bg-orange-500"
                style={{ height: `${Math.max((item.count / max) * 100, item.count > 0 ? 4 : 0)}%` }}
              />
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-between text-[10px] text-slate-500">
          <span>{values[0]?.day}</span>
          <span>{values.at(-1)?.day}</span>
        </div>
        <p className="sr-only">{values.map((item) => `${item.day}: ${item.count}`).join("; ")}</p>
      </CardContent>
    </Card>
  );
}
