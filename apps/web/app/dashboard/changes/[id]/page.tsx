import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { riskBadgeVariant, policyBadgeVariant, evidenceBadgeVariant } from "@/lib/badges";
import {
  getCurrentUser,
  getOrganizationMembers,
  getOrganizations,
  getSelectedOrganization,
  getPullRequestDetail,
} from "@/lib/api";
import { resolveApprovalRequirements } from "@ai-sdlc/policy";
import { ReviewWorkflow } from "./review-workflow";

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
  const [currentUser, members] = await Promise.all([
    getCurrentUser(),
    latestPolicy?.action === "REVIEW"
      ? getOrganizationMembers(selectedOrg.id)
      : Promise.resolve([]),
  ]);
  const sensitiveAreas = Array.from(new Set(change.codeChanges.flatMap((c) => c.sensitiveAreas)));
  const riskFactors = Array.isArray(latestRisk?.factors)
    ? latestRisk.factors.filter(
        (factor): factor is { name: string; weight: number; description: string } =>
          typeof factor === "object" &&
          factor !== null &&
          "name" in factor &&
          typeof factor.name === "string" &&
          "weight" in factor &&
          typeof factor.weight === "number" &&
          "description" in factor &&
          typeof factor.description === "string",
      )
    : [];
  const provenanceEvidence = Array.isArray(latestAi?.metadata?.["evidence"])
    ? latestAi.metadata["evidence"].filter(
        (item): item is { reason: string; detail?: string } =>
          typeof item === "object" &&
          item !== null &&
          "reason" in item &&
          typeof item.reason === "string",
      )
    : [];

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
        {change.passports[0] && (
          <a
            href={`/api/backend/api/organizations/${encodeURIComponent(selectedOrg.id)}/passports/${encodeURIComponent(change.passports[0].id)}/export`}
            className="mt-3 inline-flex rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Export Change Passport
          </a>
        )}
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI provenance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {latestAi ? (
              <>
                {latestAi.involvement === "UNKNOWN" ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-950">
                    <p className="font-medium">AI use is unconfirmed</p>
                    <p className="mt-1 leading-5">
                      Available GitHub metadata does not confirm or rule out AI assistance. This is
                      not a negative AI-use finding, and no agent or confidence percentage is
                      inferred.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">
                        {latestAi.involvement === "YES" ? "AI-assisted" : "No AI signal detected"}
                      </Badge>
                      {latestAi.involvement === "YES" && (
                        <span className="text-slate-600">
                          {latestAi.agent !== "unknown" ? latestAi.agent : "Agent unspecified"}
                          {latestAi.model ? ` · ${latestAi.model}` : ""}
                        </span>
                      )}
                    </div>
                    <p className="pt-1 text-slate-600">
                      Evidence source: {latestAi.source.toLowerCase().replaceAll("_", " ")}
                    </p>
                    <p className="text-slate-600">
                      Signal confidence: {Math.round(latestAi.confidence * 100)}%
                    </p>
                  </>
                )}
                {provenanceEvidence.length > 0 && (
                  <ul className="list-disc space-y-1 pl-5 pt-2 text-slate-600">
                    {provenanceEvidence.map((item, index) => (
                      <li key={`${item.reason}-${index}`}>
                        {item.reason}
                        {item.detail ? ` — ${item.detail}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="text-slate-600">
                Provenance has not been assessed for this change yet.
              </p>
            )}
          </CardContent>
        </Card>

        {latestPolicy?.action === "REVIEW" && currentUser && (
          <ReviewWorkflow
            organizationId={selectedOrg.id}
            pullRequestId={change.id}
            headSha={change.headSha}
            authorLogin={change.authorLogin}
            currentUserId={currentUser.id}
            actorRole={selectedOrg.role}
            requiredApprovals={latestPolicy.requiredApprovals}
            requirements={resolveApprovalRequirements(latestPolicy.requiredApprovals)}
            reviews={change.reviews}
            members={members}
          />
        )}

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
                {latestRisk.explanation && (
                  <p className="text-slate-600">{latestRisk.explanation}</p>
                )}
                {riskFactors.length > 0 && (
                  <div className="mt-3 border-t border-slate-200 pt-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Score factors · {latestRisk.modelVersion}
                    </h3>
                    <ul className="mt-2 divide-y divide-slate-100">
                      {riskFactors.map((factor) => (
                        <li
                          key={factor.name}
                          className="flex flex-wrap items-baseline justify-between gap-2 py-2"
                        >
                          <span className="font-medium text-slate-700">{factor.name}</span>
                          <span className="text-slate-600">
                            +{factor.weight} · {factor.description}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
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
                <Badge variant={policyBadgeVariant(latestPolicy.action)}>
                  {latestPolicy.action}
                </Badge>
                {latestPolicy.requiredApprovals.length > 0 && (
                  <p className="text-slate-600">
                    Required approvals: {latestPolicy.requiredApprovals.join(", ")}
                  </p>
                )}
                {latestPolicy.explanation && (
                  <p className="text-slate-600">{latestPolicy.explanation}</p>
                )}
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
