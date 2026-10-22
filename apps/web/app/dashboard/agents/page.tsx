import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { riskBadgeVariant } from "@/lib/badges";
import { getOrganizations, getSelectedOrganization, getAgents, getOverview } from "@/lib/api";
import Link from "next/link";
import { Bot, CircleHelp } from "lucide-react";

function riskLevelFromScore(score: number): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  if (score >= 80) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 35) return "MEDIUM";
  return "LOW";
}

export default async function AgentsPage() {
  const organizations = await getOrganizations();
  const selectedOrg = await getSelectedOrganization(organizations);

  if (!selectedOrg) {
    return null;
  }

  const [agents, overview] = await Promise.all([
    getAgents(selectedOrg.id),
    getOverview(selectedOrg.id),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
          Provenance and activity
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">AI agents</h1>
        <p className="mt-1 text-sm text-slate-500">{selectedOrg.name}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-sky-50 text-sky-700">
              <Bot className="h-5 w-5" />
            </span>
            <div>
              <p className="text-2xl font-semibold tabular-nums text-slate-900">
                {overview?.aiAssistedPullRequests ?? "—"}
              </p>
              <p className="text-sm text-slate-500">Verified AI-assisted pull requests</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-amber-50 text-amber-700">
              <CircleHelp className="h-5 w-5" />
            </span>
            <div>
              <p className="text-2xl font-semibold tabular-nums text-slate-900">
                {overview?.unattributedPullRequests ?? "—"}
              </p>
              <p className="text-sm text-slate-500">Pull requests with unknown AI provenance</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950">
        Agent activity includes only explicit AI-use declarations or recognized AI coding-agent bot
        accounts. Unknown provenance is kept separate; it does not mean AI was or was not used.
      </div>

      <Card>
        <CardContent className="p-0">
          {agents.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <Bot className="mx-auto h-8 w-8 text-slate-400" />
              <p className="mt-3 text-sm font-semibold text-slate-900">
                No verified AI-agent activity yet
              </p>
              <p className="mx-auto mt-1 max-w-xl text-sm text-slate-500">
                When a pull request explicitly declares AI assistance or is authored by a recognized
                AI coding-agent bot, its activity will be summarized here. We do not guess agent
                identities from ordinary PR text.
              </p>
              <Link
                href="/dashboard/changes"
                className="mt-4 inline-flex text-sm font-medium text-orange-700 hover:text-orange-800"
              >
                Review all changes
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[760px] w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Agent</th>
                    <th className="px-4 py-3 font-medium">Pull requests</th>
                    <th className="px-4 py-3 font-medium">Repositories</th>
                    <th className="px-4 py-3 font-medium">Average risk</th>
                    <th className="px-4 py-3 font-medium">Blocked</th>
                    <th className="px-4 py-3 font-medium">Review required</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map((agent) => (
                    <tr key={agent.agent} className="border-t border-slate-200 hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">{agent.agent}</td>
                      <td className="px-4 py-3 text-slate-600">{agent.pullRequestCount}</td>
                      <td className="px-4 py-3 text-slate-600">{agent.repositoryCount}</td>
                      <td className="px-4 py-3">
                        {agent.averageRiskScore != null ? (
                          <Badge
                            variant={riskBadgeVariant(riskLevelFromScore(agent.averageRiskScore))}
                          >
                            {agent.averageRiskScore}
                          </Badge>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{agent.blockedCount}</td>
                      <td className="px-4 py-3 text-slate-600">{agent.reviewRequiredCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
