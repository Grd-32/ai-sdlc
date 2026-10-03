import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getOrganizations, getSelectedOrganization, getOverview, type OverviewMetrics } from "@/lib/api";

const METRICS: Array<{ key: keyof OverviewMetrics; label: string }> = [
  { key: "aiAssistedPullRequests", label: "AI-assisted PRs" },
  { key: "highRiskChanges", label: "High-risk changes" },
  { key: "criticalChanges", label: "Critical changes" },
  { key: "blockedChanges", label: "Blocked changes" },
  { key: "reviewRequiredChanges", label: "Review required" },
  { key: "totalPassports", label: "Change Passports" },
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

  const overview = await getOverview(selectedOrg.id);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Overview</h1>
        <p className="text-sm text-slate-500">{selectedOrg.name}</p>
      </div>

      {!overview ? (
        <p className="text-sm text-slate-500">Unable to load metrics right now.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {METRICS.map((metric) => (
            <Card key={metric.key}>
              <CardHeader className="pb-2">
                <CardTitle className="text-3xl">{overview[metric.key]}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-500">{metric.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}