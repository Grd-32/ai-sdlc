import Link from "next/link";
import { simulatePolicyHistory } from "@ai-sdlc/policy";
import type { SensitiveArea } from "@ai-sdlc/risk";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getOrganizations, getSelectedOrganization, getOverview } from "@/lib/api";

const controls = [
  {
    label: "SSO enforcement",
    status: "Configuration required",
    detail: "Configure an identity provider and verified domain before enforcement",
  },
  {
    label: "SCIM provisioning",
    status: "Available",
    detail: "Provisioning endpoints exist; connect an identity provider to use them",
  },
  {
    label: "Retention policy",
    status: "Scheduled",
    detail: "Session and webhook cleanup jobs run in the worker",
  },
  {
    label: "Policy mode",
    status: "DRY_RUN",
    detail: "Default safe execution mode before enforcement",
  },
  {
    label: "Audit trail",
    status: "Recorded",
    detail: "Key actions are recorded in the organization log",
  },
];

const executiveMetrics = [
  { key: "aiAssistedPullRequests", label: "AI-assisted PRs", tone: "text-sky-600" },
  { key: "highRiskChanges", label: "High-risk changes", tone: "text-amber-600" },
  { key: "criticalChanges", label: "Critical changes", tone: "text-red-600" },
  { key: "blockedChanges", label: "Blocked changes", tone: "text-red-600" },
  { key: "reviewRequiredChanges", label: "Review required", tone: "text-amber-600" },
  { key: "totalPassports", label: "Change Passports", tone: "text-slate-900" },
] as const;

const samplePolicyHistory = [
  {
    aiInvolvement: "YES" as const,
    aiConfidence: 0.94,
    sensitiveAreas: ["SECRETS"] as SensitiveArea[],
    riskScore: 94,
    riskLevel: "CRITICAL" as const,
    repositoryCriticality: "HIGH" as const,
    repository: "payments-service",
    team: "Platform Security",
    pullRequestId: "PR-101",
  },
  {
    aiInvolvement: "YES" as const,
    aiConfidence: 0.76,
    sensitiveAreas: ["PAYMENTS"] as SensitiveArea[],
    riskScore: 58,
    riskLevel: "MEDIUM" as const,
    repositoryCriticality: "MEDIUM" as const,
    repository: "billing-api",
    team: "Payments",
    pullRequestId: "PR-102",
  },
  {
    aiInvolvement: "NO" as const,
    aiConfidence: 0,
    sensitiveAreas: [] as SensitiveArea[],
    riskScore: 10,
    riskLevel: "LOW" as const,
    repositoryCriticality: "LOW" as const,
    repository: "docs",
    team: "Docs",
    pullRequestId: "PR-103",
  },
] satisfies Parameters<typeof simulatePolicyHistory>[0];

const complianceReadiness = [
  "Organization-level policies are available; review configured rules before enforcement.",
  "Audit events are recorded; verify retention and export requirements for your deployment.",
  "Role-based access is enforced; confirm that organization memberships and roles are correct.",
  "Operational runbooks are available; production recovery and response sign-off remain operator tasks.",
];

export default async function AdminPage() {
  const organizations = await getOrganizations();
  const selectedOrg = await getSelectedOrganization(organizations);
  const overview = selectedOrg ? await getOverview(selectedOrg.id) : null;
  const policySimulation = simulatePolicyHistory(samplePolicyHistory, "DRY_RUN");
  const simulationRows = policySimulation.decisions.map((decision) => ({
    scenario: decision.pullRequestId ?? decision.repository ?? "Unknown change",
    risk: decision.riskLevel,
    action: decision.action,
    owner: decision.team ?? "Security",
  }));

  if (!selectedOrg) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Admin console</h1>
          <p className="text-sm text-slate-500">{selectedOrg.name}</p>
        </div>
        <Link
          href="/dashboard/settings"
          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Open settings
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {executiveMetrics.map((metric) => (
          <Card key={metric.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-500">{metric.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-3xl font-semibold ${metric.tone}`}>
                {overview ? overview[metric.key] : "—"}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {!overview && (
        <p role="status" className="text-sm text-amber-800">
          Live organization metrics are temporarily unavailable.
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Enterprise controls</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {controls.map((control) => (
              <div
                key={control.label}
                className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 p-3"
              >
                <div>
                  <div className="font-medium text-slate-900">{control.label}</div>
                  <div className="text-sm text-slate-500">{control.detail}</div>
                </div>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                  {control.status}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Readiness notes</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-2 pl-5 text-sm text-slate-600">
              {complianceReadiness.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Example policy simulation</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-slate-500">
            Illustrative sample scenarios only; these rows are not organization pull requests or
            policy decisions.
          </p>
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-medium">Scenario</th>
                  <th className="px-4 py-3 font-medium">Risk</th>
                  <th className="px-4 py-3 font-medium">Result</th>
                  <th className="px-4 py-3 font-medium">Owner</th>
                </tr>
              </thead>
              <tbody>
                {simulationRows.map((row) => (
                  <tr key={row.scenario} className="border-t border-slate-200">
                    <td className="px-4 py-3 font-medium text-slate-900">{row.scenario}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                        {row.risk}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          row.action === "BLOCK"
                            ? "text-red-600"
                            : row.action === "REVIEW"
                              ? "text-amber-600"
                              : "text-emerald-600"
                        }
                      >
                        {row.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{row.owner}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
