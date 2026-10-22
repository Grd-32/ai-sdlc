import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { evidenceBadgeVariant } from "@/lib/badges";
import { getOrganizations, getSelectedOrganization, getEvidence, getRepositories } from "@/lib/api";
import { FileCheck2, ShieldAlert } from "lucide-react";

export default async function EvidencePage() {
  const organizations = await getOrganizations();
  const selectedOrg = await getSelectedOrganization(organizations);

  if (!selectedOrg) {
    return null;
  }

  const [evidence, repositories] = await Promise.all([
    getEvidence(selectedOrg.id),
    getRepositories(selectedOrg.id),
  ]);
  const connectedRepositories = repositories.filter((repository) => repository.enabled);
  const statusCounts = evidence.reduce(
    (counts, item) => {
      counts[item.status] = (counts[item.status] ?? 0) + 1;
      return counts;
    },
    {} as Record<string, number>,
  );

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
          Security assurance
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
          Evidence and checks
        </h1>
        <p className="mt-1 text-sm text-slate-500">{selectedOrg.name}</p>
      </div>

      {evidence.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {(["PASS", "FAIL", "NOT_RUN", "UNKNOWN", "NOT_APPLICABLE"] as const).map((status) => (
            <Card key={status}>
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    {status.replaceAll("_", " ")}
                  </p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
                    {statusCounts[status] ?? 0}
                  </p>
                </div>
                {status === "FAIL" || status === "NOT_RUN" ? (
                  <ShieldAlert className="h-5 w-5 text-amber-700" />
                ) : (
                  <FileCheck2 className="h-5 w-5 text-slate-500" />
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {statusCounts["NOT_RUN"] ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Some evidence sources have not run or are not configured. A <strong>NOT RUN</strong>{" "}
          result is not a pass and should not be treated as a clean security scan.
        </div>
      ) : null}

      <Card>
        <CardContent className="p-0">
          {evidence.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <FileCheck2 className="mx-auto h-8 w-8 text-slate-400" />
              <p className="mt-3 text-sm font-semibold text-slate-900">
                No security evidence has been recorded
              </p>
              <p className="mx-auto mt-1 max-w-lg text-sm text-slate-500">
                {connectedRepositories.length > 0
                  ? `Evidence is attached to pull request analysis. Your organization has ${connectedRepositories.length} connected ${
                      connectedRepositories.length === 1 ? "repository" : "repositories"
                    }. Open or update a pull request there to start building an auditable record.`
                  : "Evidence is attached to pull request analysis. Connect a repository and send a pull request event to start building an auditable record."}
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
              <table className="min-w-[780px] w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">Source</th>
                    <th className="px-4 py-3 font-medium">Result</th>
                    <th className="px-4 py-3 font-medium">Related change</th>
                    <th className="px-4 py-3 font-medium">Recorded</th>
                  </tr>
                </thead>
                <tbody>
                  {evidence.map((item) => {
                    const reason = item.metadata?.["reason"];
                    return (
                      <tr key={item.id} className="border-t border-slate-200 hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-900">{item.type}</td>
                        <td className="px-4 py-3 text-slate-600">{item.source}</td>
                        <td className="px-4 py-3">
                          <Badge variant={evidenceBadgeVariant(item.status)}>
                            {item.status.replaceAll("_", " ")}
                          </Badge>
                          {typeof reason === "string" && (
                            <p className="mt-1 max-w-xs text-xs text-slate-500">{reason}</p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {item.pullRequest ? (
                            <Link
                              href={`/dashboard/changes/${item.pullRequest.id}`}
                              className="font-medium text-orange-700 hover:text-orange-800"
                            >
                              #{item.pullRequest.number} · {item.pullRequest.repository.owner}/
                              {item.pullRequest.repository.name}
                            </Link>
                          ) : (
                            <span className="text-slate-400">Organization-level</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-500">
                          {new Date(item.createdAt).toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
