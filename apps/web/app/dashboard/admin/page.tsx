import Link from "next/link";
import { AlertTriangle, Bot, FileCheck2, FolderGit2, GitBranch, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getEvidence,
  getInstallations,
  getOrganizations,
  getOverview,
  getPolicies,
  getRepositories,
  getSelectedOrganization,
} from "@/lib/api";

export default async function AdminPage() {
  const organizations = await getOrganizations();
  const selectedOrg = await getSelectedOrganization(organizations);

  if (!selectedOrg) {
    return null;
  }

  if (!["OWNER", "ADMIN"].includes(selectedOrg.role.toUpperCase())) {
    return (
      <Card className="mx-auto max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">Administrator access required</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-slate-600">
          <p>
            The administration console contains organization configuration and readiness
            information. Ask an organization owner or administrator to grant you access.
          </p>
          <Link href="/dashboard" className="font-medium text-orange-700 hover:text-orange-800">
            Return to overview
          </Link>
        </CardContent>
      </Card>
    );
  }

  const [overview, repositories, installations, policies, evidence] = await Promise.all([
    getOverview(selectedOrg.id),
    getRepositories(selectedOrg.id),
    getInstallations(selectedOrg.id),
    getPolicies(selectedOrg.id),
    getEvidence(selectedOrg.id),
  ]);
  const activeInstallations = installations.filter((installation) => installation.active).length;
  const enabledRepositories = repositories.filter((repository) => repository.enabled).length;
  const enabledPolicies = policies.filter((policy) => policy.enabled);
  const evidenceNotRun = evidence.filter((item) => item.status === "NOT_RUN").length;
  const evidenceFailed = evidence.filter((item) => item.status === "FAIL").length;

  const sections = [
    {
      label: "GitHub integration",
      value: `${activeInstallations} active`,
      detail: `${enabledRepositories} enabled repositories`,
      href: "/dashboard/repositories",
      icon: FolderGit2,
      tone: activeInstallations > 0 ? "text-emerald-700" : "text-amber-700",
      status: activeInstallations > 0 ? "Connected" : "Setup required",
    },
    {
      label: "Policy coverage",
      value: `${enabledPolicies.length} enabled`,
      detail: `${policies.length} organization policies`,
      href: "/dashboard/policies",
      icon: ShieldCheck,
      tone: enabledPolicies.length > 0 ? "text-sky-700" : "text-slate-700",
      status: enabledPolicies.length > 0 ? "Configured" : "No custom policies",
    },
    {
      label: "AI provenance",
      value: `${overview?.aiAssistedPullRequests ?? "—"} verified`,
      detail: `${overview?.unattributedPullRequests ?? "—"} unknown`,
      href: "/dashboard/agents",
      icon: Bot,
      tone: "text-sky-700",
      status: "Evidence-based",
    },
    {
      label: "Security evidence",
      value: `${evidence.length} records`,
      detail: `${evidenceNotRun} not run · ${evidenceFailed} failed`,
      href: "/dashboard/evidence",
      icon: FileCheck2,
      tone: evidenceFailed > 0 || evidenceNotRun > 0 ? "text-amber-700" : "text-emerald-700",
      status:
        evidenceFailed > 0
          ? "Failures recorded"
          : evidenceNotRun > 0
            ? "Coverage incomplete"
            : evidence.length > 0
              ? "Evidence recorded"
              : "No evidence yet",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
          Organization controls
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
          Administration
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Live configuration and governance coverage for {selectedOrg.name}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {sections.map((section) => {
          const Icon = section.icon;
          return (
            <Link key={section.label} href={section.href} className="group">
              <Card className="h-full transition-colors group-hover:border-slate-300">
                <CardHeader className="flex-row items-start justify-between space-y-0 pb-3">
                  <div>
                    <p className="text-sm font-medium text-slate-600">{section.label}</p>
                    <p className={`mt-2 text-xl font-semibold ${section.tone}`}>{section.value}</p>
                  </div>
                  <Icon className={`h-5 w-5 ${section.tone}`} />
                </CardHeader>
                <CardContent className="flex items-center justify-between gap-2">
                  <p className="text-xs text-slate-500">{section.detail}</p>
                  <Badge variant="outline">{section.status}</Badge>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Operational readiness</CardTitle>
          <p className="text-sm text-slate-500">
            These indicators reflect recorded organization data, not sample scenarios.
          </p>
        </CardHeader>
        <CardContent className="divide-y divide-slate-200 p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div className="flex items-start gap-3">
              <GitBranch className="mt-0.5 h-4 w-4 text-slate-500" />
              <div>
                <p className="text-sm font-medium text-slate-900">Repositories monitored</p>
                <p className="mt-0.5 text-sm text-slate-500">
                  {enabledRepositories} enabled of {repositories.length} connected
                </p>
              </div>
            </div>
            <Link
              href="/dashboard/repositories"
              className="text-sm font-medium text-orange-700 hover:text-orange-800"
            >
              Manage repositories
            </Link>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 text-slate-500" />
              <div>
                <p className="text-sm font-medium text-slate-900">Policy modes</p>
                <p className="mt-0.5 text-sm text-slate-500">
                  {enabledPolicies.length === 0
                    ? "No enabled organization policies"
                    : enabledPolicies
                        .map((policy) => `${policy.mode.replaceAll("_", " ")} · ${policy.name}`)
                        .join("; ")}
                </p>
              </div>
            </div>
            <Link
              href="/dashboard/policies"
              className="text-sm font-medium text-orange-700 hover:text-orange-800"
            >
              Review policies
            </Link>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-700" />
              <div>
                <p className="text-sm font-medium text-slate-900">Evidence coverage</p>
                <p className="mt-0.5 text-sm text-slate-500">
                  {evidenceNotRun > 0
                    ? `${evidenceNotRun} checks are marked NOT RUN; these are not passing results.`
                    : evidence.length > 0
                      ? "Recorded evidence is available for review."
                      : "No evidence has been recorded yet."}
                </p>
              </div>
            </div>
            <Link
              href="/dashboard/evidence"
              className="text-sm font-medium text-orange-700 hover:text-orange-800"
            >
              View evidence
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
