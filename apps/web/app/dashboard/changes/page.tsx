import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { riskBadgeVariant, policyBadgeVariant } from "@/lib/badges";
import {
  getOrganizations,
  getSelectedOrganization,
  getPullRequests,
  getRepositories,
} from "@/lib/api";
import { GitPullRequest, Search } from "lucide-react";

export default async function ChangesPage() {
  const organizations = await getOrganizations();
  const selectedOrg = await getSelectedOrganization(organizations);

  if (!selectedOrg) {
    return null;
  }

  const [pullRequests, repositories] = await Promise.all([
    getPullRequests(selectedOrg.id),
    getRepositories(selectedOrg.id),
  ]);
  const connectedRepositories = repositories.filter((repository) => repository.enabled);
  const attributedCount = pullRequests.filter((pr) => pr.aiInvolvement === "YES").length;
  const unattributedCount = pullRequests.filter((pr) => pr.aiInvolvement === "UNKNOWN").length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            Pull request governance
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Changes</h1>
          <p className="mt-1 text-sm text-slate-500">
            {selectedOrg.name} · {pullRequests.length} latest changes
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 font-medium text-sky-800">
            {attributedCount} AI-attributed
          </span>
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 font-medium text-amber-800">
            {unattributedCount} unattributed
          </span>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {pullRequests.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <GitPullRequest className="mx-auto h-8 w-8 text-slate-400" />
              <p className="mt-3 text-sm font-semibold text-slate-900">
                No pull requests received yet
              </p>
              <p className="mx-auto mt-1 max-w-lg text-sm text-slate-500">
                {connectedRepositories.length > 0
                  ? `Your organization has ${connectedRepositories.length} connected ${
                      connectedRepositories.length === 1 ? "repository" : "repositories"
                    }. Open or update a pull request there; its analysis and policy decision will appear here.`
                  : "Connect a repository, then open or update a pull request. Its analysis and policy decision will appear here."}
              </p>
              <Link
                href="/dashboard/repositories"
                className="mt-4 inline-flex rounded-md bg-slate-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-slate-700"
              >
                {connectedRepositories.length > 0 ? "View repositories" : "Connect a repository"}
              </Link>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <Search className="h-4 w-4" />
                  <span>Latest pull requests across connected repositories</span>
                </div>
                <span className="text-xs text-slate-500">
                  AI attribution is shown only when supported by evidence
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-[1000px] w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Pull request</th>
                      <th className="px-4 py-3 font-medium">Repository</th>
                      <th className="px-4 py-3 font-medium">Author</th>
                      <th className="px-4 py-3 font-medium">AI attribution</th>
                      <th className="px-4 py-3 font-medium">Risk</th>
                      <th className="px-4 py-3 font-medium">Policy</th>
                      <th className="px-4 py-3 font-medium">State</th>
                      <th className="px-4 py-3 font-medium">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pullRequests.map((pr) => (
                      <tr key={pr.id} className="border-t border-slate-200 hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <Link
                            href={`/dashboard/changes/${pr.id}`}
                            className="font-medium text-slate-900 hover:text-orange-700"
                          >
                            #{pr.number} {pr.title}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{pr.repository}</td>
                        <td className="px-4 py-3 text-slate-600">{pr.author ?? "—"}</td>
                        <td className="px-4 py-3">
                          {pr.aiInvolvement === "YES" ? (
                            <span className="inline-flex items-center gap-1.5">
                              <Badge variant="secondary">{pr.aiAgent ?? "AI-assisted"}</Badge>
                              {pr.aiConfidence != null && (
                                <span className="text-xs text-slate-500">
                                  {Math.round(pr.aiConfidence * 100)}% confidence
                                </span>
                              )}
                            </span>
                          ) : (
                            <Badge variant="outline">
                              {pr.aiInvolvement === "NO" ? "No signal detected" : "Unattributed"}
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {pr.riskLevel ? (
                            <span className="inline-flex items-center gap-2">
                              <Badge variant={riskBadgeVariant(pr.riskLevel)}>{pr.riskLevel}</Badge>
                              {pr.riskScore != null && (
                                <span className="text-xs tabular-nums text-slate-500">
                                  {pr.riskScore}/100
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-slate-400">Pending</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {pr.policyAction ? (
                            <Badge variant={policyBadgeVariant(pr.policyAction)}>
                              {pr.policyAction}
                            </Badge>
                          ) : (
                            <span className="text-slate-400">Pending</span>
                          )}
                        </td>
                        <td className="px-4 py-3 capitalize text-slate-600">
                          {pr.state.toLowerCase().replaceAll("_", " ")}
                        </td>
                        <td className="px-4 py-3 text-slate-500">
                          {new Date(pr.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
