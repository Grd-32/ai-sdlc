import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { riskBadgeVariant, policyBadgeVariant } from "@/lib/badges";
import { getOrganizations, getSelectedOrganization, getPullRequests } from "@/lib/api";

export default async function ChangesPage() {
  const organizations = await getOrganizations();
  const selectedOrg = await getSelectedOrganization(organizations);

  if (!selectedOrg) {
    return null;
  }

  const pullRequests = await getPullRequests(selectedOrg.id);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Changes</h1>
        <p className="text-sm text-slate-500">{selectedOrg.name}</p>
      </div>

      <Card>
        <CardContent className="p-0">
          {pullRequests.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No pull requests analyzed yet.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Pull Request</th>
                  <th className="px-4 py-3 font-medium">Repository</th>
                  <th className="px-4 py-3 font-medium">Author</th>
                  <th className="px-4 py-3 font-medium">AI Agent</th>
                  <th className="px-4 py-3 font-medium">Risk</th>
                  <th className="px-4 py-3 font-medium">Policy</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {pullRequests.map((pr) => (
                  <tr key={pr.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboard/changes/${pr.id}`}
                        className="font-medium text-slate-900 hover:underline"
                      >
                        #{pr.number} {pr.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{pr.repository}</td>
                    <td className="px-4 py-3 text-slate-600">{pr.author ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {pr.aiInvolvement === "YES"
                        ? `${pr.aiAgent ?? "Unknown"} (${
                            pr.aiConfidence != null ? Math.round(pr.aiConfidence * 100) : "?"
                          }%)`
                        : pr.aiInvolvement}
                    </td>
                    <td className="px-4 py-3">
                      {pr.riskLevel ? (
                        <Badge variant={riskBadgeVariant(pr.riskLevel)}>{pr.riskLevel}</Badge>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {pr.policyAction ? (
                        <Badge variant={policyBadgeVariant(pr.policyAction)}>{pr.policyAction}</Badge>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{pr.state}</td>
                    <td className="px-4 py-3 text-slate-500">
                      {new Date(pr.createdAt).toLocaleDateString()}
                    </td>
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