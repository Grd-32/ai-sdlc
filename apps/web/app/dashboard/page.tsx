import Link from "next/link";
import {
  AlertTriangle,
  Bot,
  ClipboardCheck,
  FileCheck2,
  GitPullRequest,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { policyBadgeVariant, riskBadgeVariant } from "@/lib/badges";
import {
  getOrganizations,
  getSelectedOrganization,
  getOverview,
  getPullRequests,
  getRepositories,
  type OverviewMetrics,
} from "@/lib/api";

const METRICS: Array<{
  key: keyof OverviewMetrics;
  label: string;
  href: string;
  icon: typeof Bot;
  tone: string;
}> = [
  {
    key: "aiAssistedPullRequests",
    label: "Verified AI-assisted PRs",
    href: "/dashboard/agents",
    icon: Bot,
    tone: "text-sky-700",
  },
  {
    key: "unattributedPullRequests",
    label: "AI attribution unknown",
    href: "/dashboard/changes",
    icon: AlertTriangle,
    tone: "text-amber-700",
  },
  {
    key: "highRiskChanges",
    label: "High-risk changes",
    href: "/dashboard/changes",
    icon: ShieldAlert,
    tone: "text-orange-700",
  },
  {
    key: "criticalChanges",
    label: "Critical changes",
    href: "/dashboard/changes",
    icon: ShieldAlert,
    tone: "text-red-700",
  },
  {
    key: "blockedChanges",
    label: "Blocked by policy",
    href: "/dashboard/changes",
    icon: ShieldCheck,
    tone: "text-red-700",
  },
  {
    key: "reviewRequiredChanges",
    label: "Review required",
    href: "/dashboard/changes",
    icon: ClipboardCheck,
    tone: "text-amber-700",
  },
  {
    key: "totalPassports",
    label: "Change Passports",
    href: "/dashboard/changes",
    icon: FileCheck2,
    tone: "text-slate-900",
  },
];

export default async function OverviewPage() {
  const organizations = await getOrganizations();
  const selectedOrg = await getSelectedOrganization(organizations);

  // Layout already renders the empty-org state and doesn't render {children}
  // in that case, so this is unreachable in practice — kept as a defensive
  // guard rather than assuming that invariant holds forever.
  if (!selectedOrg) {
    return null;
  }

  const [overview, pullRequests, repositories] = await Promise.all([
    getOverview(selectedOrg.id),
    getPullRequests(selectedOrg.id),
    getRepositories(selectedOrg.id),
  ]);
  const connectedRepositories = repositories.filter((repository) => repository.enabled);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            Organization overview
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
            Security posture
          </h1>
        </div>
        <Link
          href="/dashboard/changes"
          className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          <GitPullRequest className="h-4 w-4" />
          View changes
        </Link>
      </div>

      {overview && repositories.length === 0 && (
        <section className="rounded-xl border border-orange-200 bg-orange-50/70 p-5 sm:p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-2xl">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-orange-800">
                Workspace setup · 2 of 3
              </p>
              <h2 className="mt-2 text-lg font-semibold text-slate-950">
                Connect your first repository
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-700">
                Install the GitHub App, select a test repository, then open or update a pull request
                to see its change analysis and evidence here.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {["OWNER", "ADMIN"].includes(selectedOrg.role.toUpperCase()) && (
                <Link
                  href={`/api/github/installations/start?organizationId=${encodeURIComponent(selectedOrg.id)}`}
                  className="inline-flex items-center justify-center rounded-md bg-orange-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-800"
                >
                  Connect GitHub
                </Link>
              )}
              <Link
                href="/docs/quickstart"
                className="inline-flex items-center justify-center rounded-md border border-orange-300 bg-white px-4 py-2.5 text-sm font-semibold text-orange-900 hover:bg-orange-100"
              >
                Setup guide
              </Link>
            </div>
          </div>
          {!["OWNER", "ADMIN"].includes(selectedOrg.role.toUpperCase()) && (
            <p className="mt-3 text-xs text-slate-600">
              An organization owner or administrator must connect the GitHub App.
            </p>
          )}
        </section>
      )}
      {overview && repositories.length > 0 && pullRequests.length === 0 && (
        <section className="rounded-xl border border-sky-200 bg-sky-50/70 p-5 sm:p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-2xl">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-sky-800">
                Workspace setup · 3 of 3
              </p>
              <h2 className="mt-2 text-lg font-semibold text-slate-950">
                Review your first pull request
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-700">
                Your repository is connected. Open or update a pull request there, then return to
                Changes to inspect risk, policy decisions, attribution, and evidence.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Link
                href="/dashboard/changes"
                className="inline-flex items-center justify-center rounded-md bg-sky-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-900"
              >
                View changes
              </Link>
              <Link
                href="/docs/quickstart"
                className="inline-flex items-center justify-center rounded-md border border-sky-300 bg-white px-4 py-2.5 text-sm font-semibold text-sky-900 hover:bg-sky-100"
              >
                Quickstart
              </Link>
            </div>
          </div>
        </section>
      )}

      {!overview ? (
        <p
          role="status"
          className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          Organization metrics could not be loaded. Refresh the page or check the API service.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {METRICS.map((metric) => (
            <Link key={metric.key} href={metric.href} className="group">
              <Card className="h-full transition-colors group-hover:border-slate-300">
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
                  <CardTitle className="text-xs font-medium text-slate-600">
                    {metric.label}
                  </CardTitle>
                  <metric.icon className={`h-4 w-4 ${metric.tone}`} />
                </CardHeader>
                <CardContent>
                  <p className={`text-3xl font-semibold tabular-nums ${metric.tone}`}>
                    {overview[metric.key]}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(280px,0.8fr)]">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Recent changes</CardTitle>
              <p className="mt-1 text-sm text-slate-500">
                Pull requests received from connected repositories
              </p>
            </div>
            <Link
              href="/dashboard/changes"
              className="text-sm font-medium text-orange-700 hover:text-orange-800"
            >
              View all
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {pullRequests.length === 0 ? (
              <div className="px-6 py-10 text-center">
                <GitPullRequest className="mx-auto h-8 w-8 text-slate-400" />
                <p className="mt-3 text-sm font-medium text-slate-800">
                  No pull requests have been analyzed yet
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {connectedRepositories.length > 0
                    ? `Your organization has ${connectedRepositories.length} connected ${
                        connectedRepositories.length === 1 ? "repository" : "repositories"
                      }. Open or update a pull request there to see its assessment here.`
                    : "Connect a repository and open or update a pull request to start receiving change assessments."}
                </p>
                <Link
                  href="/dashboard/repositories"
                  className="mt-4 inline-flex rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  View repositories
                </Link>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[760px] w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-3 font-medium">Change</th>
                      <th className="px-5 py-3 font-medium">Repository</th>
                      <th className="px-5 py-3 font-medium">AI attribution</th>
                      <th className="px-5 py-3 font-medium">Risk</th>
                      <th className="px-5 py-3 font-medium">Policy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pullRequests.slice(0, 6).map((pr) => (
                      <tr key={pr.id} className="border-t border-slate-200 hover:bg-slate-50">
                        <td className="px-5 py-3">
                          <Link
                            href={`/dashboard/changes/${pr.id}`}
                            className="font-medium text-slate-900 hover:text-orange-700"
                          >
                            #{pr.number} {pr.title}
                          </Link>
                          <p className="mt-0.5 text-xs text-slate-500">
                            by {pr.author ?? "Unknown author"}
                          </p>
                        </td>
                        <td className="px-5 py-3 text-slate-600">{pr.repository}</td>
                        <td className="px-5 py-3 text-slate-600">
                          {pr.aiInvolvement === "YES"
                            ? `${pr.aiAgent ?? "AI agent"} · ${Math.round((pr.aiConfidence ?? 0) * 100)}%`
                            : pr.aiInvolvement === "NO"
                              ? "No signal detected"
                              : "Unattributed"}
                        </td>
                        <td className="px-5 py-3">
                          {pr.riskLevel ? (
                            <Badge variant={riskBadgeVariant(pr.riskLevel)}>{pr.riskLevel}</Badge>
                          ) : (
                            <span className="text-slate-400">Pending</span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          {pr.policyAction ? (
                            <Badge variant={policyBadgeVariant(pr.policyAction)}>
                              {pr.policyAction}
                            </Badge>
                          ) : (
                            <span className="text-slate-400">Pending</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI attribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <div>
                <p className="text-sm font-medium text-amber-950">
                  Attribution is evidence-based, not guessed
                </p>
                <p className="mt-1 text-sm leading-5 text-amber-900">
                  Only explicit AI-use declarations and recognized AI-agent bot metadata count as
                  verified. Unknown means the available metadata cannot confirm or rule out AI use.
                </p>
              </div>
            </div>
            <Link
              href="/dashboard/agents"
              className="mt-4 inline-flex text-sm font-medium text-orange-700 hover:text-orange-800"
            >
              Review AI agent activity
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
