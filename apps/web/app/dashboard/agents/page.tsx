import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { riskBadgeVariant } from "@/lib/badges";
import { getOrganizations, getSelectedOrganization, getAgents } from "@/lib/api";

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

  const agents = await getAgents(selectedOrg.id);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">AI Agents</h1>
        <p className="text-sm text-slate-500">{selectedOrg.name}</p>
      </div>

      <Card>
        <CardContent className="p-0">
          {agents.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No AI-attributed activity recorded yet.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Agent</th>
                  <th className="px-4 py-3 font-medium">Pull Requests</th>
                  <th className="px-4 py-3 font-medium">Repositories</th>
                  <th className="px-4 py-3 font-medium">Avg. Risk</th>
                  <th className="px-4 py-3 font-medium">Blocked</th>
                  <th className="px-4 py-3 font-medium">Review Required</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((agent) => (
                  <tr key={agent.agent} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3 font-medium text-slate-900">{agent.agent}</td>
                    <td className="px-4 py-3 text-slate-600">{agent.pullRequestCount}</td>
                    <td className="px-4 py-3 text-slate-600">{agent.repositoryCount}</td>
                    <td className="px-4 py-3">
                      {agent.averageRiskScore != null ? (
                        <Badge variant={riskBadgeVariant(riskLevelFromScore(agent.averageRiskScore))}>
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}