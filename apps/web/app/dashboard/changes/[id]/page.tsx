import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { riskBadgeVariant, policyBadgeVariant, evidenceBadgeVariant } from "@/lib/badges";
import { getOrganizations, getSelectedOrganization, getPullRequestDetail } from "@/lib/api";

export default async function ChangeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const organizations = await getOrganizations();
  const selectedOrg = await getSelectedOrganization(organizations);

  if (!selectedOrg) {
    return null;
  }

  const change = await getPullRequestDetail(selectedOrg.id, id);

  if (!change) {
    notFound();
  }

  const latestAi = change.aiActivities[0];
  const latestRisk = change.riskAssessments[0];
  const latestPolicy = change.policyDecisions[0];
  const sensitiveAreas = Array.from(new Set(change.codeChanges.flatMap((c) => c.sensitiveAreas)));

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <Link href="/dashboard/changes" className="text-sm text-slate-500 hover:underline">
          ← Changes
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">
          #{change.number} {change.title}
        </h1>
        <p className="text-sm text-slate-500">
          {change.repository.owner}/{change.repository.name}
        </p>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI Involvement</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {latestAi ? (
              <>
                <p>
                  <span className="text-slate-500">Involvement:</span> {latestAi.involvement}
                </p>
                <p>
                  <span className="text-slate-500">Agent:</span> {latestAi.agent}
                  {latestAi.model ? ` (${latestAi.model})` : ""}
                </p>
                <p>
                  <span className="text-slate-500">Confidence:</span>{" "}
                  {Math.round(latestAi.confidence * 100)}%
                </p>
                <p>
                  <span className="text-slate-500">Source:</span> {latestAi.source}
                </p>
              </>
            ) : (
              <p className="text-slate-400">No provenance data recorded.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Risk</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {latestRisk ? (
              <>
                <div className="flex items-center gap-2">
                  <Badge variant={riskBadgeVariant(latestRisk.level)}>{latestRisk.level}</Badge>
                  <span className="text-slate-500">score {latestRisk.score.toFixed(0)}/100</span>
                </div>
                {latestRisk.explanation && <p className="text-slate-600">{latestRisk.explanation}</p>}
              </>
            ) : (
              <p className="text-slate-400">No risk assessment recorded.</p>
            )}
            {sensitiveAreas.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {sensitiveAreas.map((area) => (
                  <Badge key={area} variant="outline">
                    {area}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Policy</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {latestPolicy ? (
              <>
                <Badge variant={policyBadgeVariant(latestPolicy.action)}>{latestPolicy.action}</Badge>
                {latestPolicy.requiredApprovals.length > 0 && (
                  <p className="text-slate-600">
                    Required approvals: {latestPolicy.requiredApprovals.join(", ")}
                  </p>
                )}
                {latestPolicy.explanation && <p className="text-slate-600">{latestPolicy.explanation}</p>}
              </>
            ) : (
              <p className="text-slate-400">No policy decision recorded.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Security Evidence</CardTitle>
          </CardHeader>
          <CardContent>
            {change.evidence.length === 0 ? (
              <p className="text-sm text-slate-400">No evidence recorded.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {change.evidence.map((e) => (
                  <li key={e.id} className="flex items-center justify-between">
                    <span className="text-slate-700">
                      {e.type} <span className="text-slate-400">via {e.source}</span>
                    </span>
                    <Badge variant={evidenceBadgeVariant(e.status)}>{e.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Changed Files</CardTitle>
          </CardHeader>
          <CardContent>
            {change.codeChanges.length === 0 ? (
              <p className="text-sm text-slate-400">No file-level analysis recorded.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {change.codeChanges.map((c) => (
                  <li key={c.id} className="flex items-center justify-between">
                    <span className="font-mono text-xs text-slate-700">{c.filePath}</span>
                    <span className="text-xs text-slate-400">
                      +{c.additions} -{c.deletions}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}