import {
  getOrganizationMembers,
  getOrganizations,
  getSecurityFindings,
  getSelectedOrganization,
} from "@/lib/api";
import { FindingWorkflow } from "./finding-workflow";

export default async function FindingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; severity?: string; overdue?: string }>;
}) {
  const filters = await searchParams;
  const organizations = await getOrganizations();
  const organization = await getSelectedOrganization(organizations);
  if (!organization) return null;

  const canManage = [
    "OWNER",
    "ADMIN",
    "SECURITY",
    "SECURITY_ADMIN",
    "SECURITY_ANALYST",
    "ENGINEER",
  ].includes(organization.role.toUpperCase());
  const [findings, members] = await Promise.all([
    getSecurityFindings(organization.id, {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.severity ? { severity: filters.severity } : {}),
      overdue: filters.overdue === "true",
    }),
    canManage ? getOrganizationMembers(organization.id) : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
          Security operations
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">Findings & remediation</h1>
        <p className="mt-1 text-sm text-slate-600">
          Triage findings, assign an owner, set a due date, and track decisions with an audit trail.
        </p>
        {(filters.status || filters.severity || filters.overdue === "true") && (
          <p className="mt-2 text-xs text-slate-500">
            Active filter:{" "}
            {[filters.status, filters.severity, filters.overdue === "true" ? "overdue" : null]
              .filter(Boolean)
              .join(" · ")}{" "}
            ·{" "}
            <a className="underline" href="/dashboard/findings">
              Clear
            </a>
          </p>
        )}
      </header>
      <FindingWorkflow
        organizationId={organization.id}
        findings={findings}
        members={members.filter((member) => member.active)}
        canManage={canManage}
      />
    </div>
  );
}
