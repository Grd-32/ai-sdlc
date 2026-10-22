// import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
// import { Badge } from "@/components/ui/badge";
// import { policyBadgeVariant } from "@/lib/badges";
// import { getOrganizations, getSelectedOrganization, getPolicies } from "@/lib/api";

// const SENSITIVE_AREAS = [
//   "AUTHENTICATION",
//   "AUTHORIZATION",
//   "PAYMENTS",
//   "CRYPTOGRAPHY",
//   "SECRETS",
//   "DATABASE",
//   "PERSONAL_DATA",
//   "INFRASTRUCTURE",
//   "NETWORKING",
//   "API",
//   "DEPENDENCIES",
//   "CI_CD",
//   "CONTAINERS",
//   "LOGGING",
//   "FRONTEND",
//   "TESTING",
//   "DOCUMENTATION",
// ] as const;

// const CRITICALITY_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

// export default async function PoliciesPage({
//   searchParams,
// }: {
//   searchParams: Promise<{ policyError?: string }>;
// }) {
//   const organizations = await getOrganizations();
//   const selectedOrg = await getSelectedOrganization(organizations);

//   if (!selectedOrg) {
//     return null;
//   }

//   const { policyError } = await searchParams;
//   const policies = await getPolicies(selectedOrg.id);

//   return (
//     <div className="mx-auto max-w-3xl">
//       <div className="mb-6">
//         <h1 className="text-2xl font-semibold text-slate-900">Policies</h1>
//         <p className="text-sm text-slate-500">{selectedOrg.name}</p>
//       </div>

//       {policyError && (
//         <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
//           {policyError}
//         </div>
//       )}

//       <Card className="mb-6">
//         <CardContent className="p-4 text-xs text-slate-500">
//           Every change is also evaluated against the platform&apos;s built-in default rules (payments,
//           secrets, authentication, infrastructure, high risk) — those always apply and can&apos;t be
//           disabled here. Policies you create below are evaluated alongside them; if more than one rule
//           matches, the strongest action wins (BLOCK &gt; REVIEW &gt; ALLOW).
//         </CardContent>
//       </Card>

//       <Card className="mb-6">
//         <CardHeader>
//           <CardTitle className="text-base">New Policy</CardTitle>
//         </CardHeader>
//         <CardContent>
//           <form action="/api/policies" method="POST" className="space-y-3">
//             <input type="hidden" name="organizationId" value={selectedOrg.id} />
//             <div>
//               <label className="block text-xs font-medium text-slate-600">Name</label>
//               <input
//                 type="text"
//                 name="name"
//                 required
//                 className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
//                 placeholder="e.g. Frontend Lockdown"
//               />
//             </div>
//             <div>
//               <label className="block text-xs font-medium text-slate-600">Description (optional)</label>
//               <input
//                 type="text"
//                 name="description"
//                 className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
//               />
//             </div>
//             <button
//               type="submit"
//               className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
//             >
//               Create Policy
//             </button>
//           </form>
//         </CardContent>
//       </Card>

//       {policies.length === 0 ? (
//         <Card>
//           <CardContent className="p-6">
//             <p className="text-sm text-slate-500">
//               No organization-defined policies yet. Create one above to add rules on top of the
//               built-in defaults.
//             </p>
//           </CardContent>
//         </Card>
//       ) : (
//         <div className="space-y-4">
//           {policies.map((policy) => (
//             <Card key={policy.id}>
//               <CardHeader className="flex-row items-center justify-between space-y-0">
//                 <div>
//                   <CardTitle className="text-base">{policy.name}</CardTitle>
//                   {policy.description && <p className="mt-1 text-sm text-slate-500">{policy.description}</p>}
//                 </div>
//                 <div className="flex items-center gap-2">
//                   <Badge variant={policy.enabled ? "success" : "outline"}>
//                     {policy.enabled ? "Enabled" : "Disabled"}
//                   </Badge>
//                   <form action={`/api/policies/${policy.id}/toggle`} method="POST">
//                     <input type="hidden" name="organizationId" value={selectedOrg.id} />
//                     <input type="hidden" name="enabled" value={(!policy.enabled).toString()} />
//                     <button
//                       type="submit"
//                       className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
//                     >
//                       {policy.enabled ? "Disable" : "Enable"}
//                     </button>
//                   </form>
//                   <form action={`/api/policies/${policy.id}/delete`} method="POST">
//                     <input type="hidden" name="organizationId" value={selectedOrg.id} />
//                     <button
//                       type="submit"
//                       className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
//                     >
//                       Delete
//                     </button>
//                   </form>
//                 </div>
//               </CardHeader>

//               <CardContent className="space-y-4">
//                 {policy.policyRules.length === 0 ? (
//                   <p className="text-sm text-slate-400">No rules yet — this policy has no effect.</p>
//                 ) : (
//                   <ul className="space-y-2">
//                     {policy.policyRules.map((rule) => (
//                       <li
//                         key={rule.id}
//                         className="flex items-start justify-between rounded-md border border-slate-100 p-3 text-sm"
//                       >
//                         <div className="space-y-1">
//                           <div className="flex items-center gap-2">
//                             <span className="font-medium text-slate-900">{rule.name}</span>
//                             <Badge variant={policyBadgeVariant(rule.action)}>{rule.action}</Badge>
//                           </div>
//                           <p className="text-xs text-slate-500">
//                             {rule.aiInvolved === true && "AI-involved · "}
//                             {rule.aiInvolved === false && "Not AI-involved · "}
//                             {rule.sensitiveAreas.length > 0 && `${rule.sensitiveAreas.join(", ")} · `}
//                             {rule.riskAtLeast != null && `risk ≥ ${rule.riskAtLeast} · `}
//                             {rule.repositoryCriticalityIn.length > 0 &&
//                               `repo: ${rule.repositoryCriticalityIn.join(", ")} · `}
//                             {rule.requiredApprovals.length > 0 &&
//                               `requires ${rule.requiredApprovals.join(", ")}`}
//                           </p>
//                           {rule.reason && <p className="text-xs text-slate-400">{rule.reason}</p>}
//                         </div>
//                         <form action={`/api/policies/${policy.id}/rules/${rule.id}/delete`} method="POST">
//                           <input type="hidden" name="organizationId" value={selectedOrg.id} />
//                           <button type="submit" className="text-xs text-red-600 hover:underline">
//                             Remove
//                           </button>
//                         </form>
//                       </li>
//                     ))}
//                   </ul>
//                 )}

//                 <details className="rounded-md border border-slate-100 p-3">
//                   <summary className="cursor-pointer text-sm font-medium text-slate-700">Add rule</summary>
//                   <form action={`/api/policies/${policy.id}/rules`} method="POST" className="mt-3 space-y-3">
//                     <input type="hidden" name="organizationId" value={selectedOrg.id} />

//                     <div>
//                       <label className="block text-xs font-medium text-slate-600">Rule name</label>
//                       <input
//                         type="text"
//                         name="name"
//                         required
//                         className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
//                       />
//                     </div>

//                     <div>
//                       <label className="block text-xs font-medium text-slate-600">AI involvement</label>
//                       <select
//                         name="aiInvolved"
//                         defaultValue=""
//                         className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
//                       >
//                         <option value="">Any</option>
//                         <option value="true">Must be AI-involved</option>
//                         <option value="false">Must NOT be AI-involved</option>
//                       </select>
//                     </div>

//                     <div>
//                       <label className="block text-xs font-medium text-slate-600">Sensitive areas</label>
//                       <div className="mt-1 grid grid-cols-3 gap-1 text-xs">
//                         {SENSITIVE_AREAS.map((area) => (
//                           <label key={area} className="flex items-center gap-1.5">
//                             <input type="checkbox" name="sensitiveAreas" value={area} />
//                             {area}
//                           </label>
//                         ))}
//                       </div>
//                     </div>

//                     <div>
//                       <label className="block text-xs font-medium text-slate-600">
//                         Minimum risk score (optional)
//                       </label>
//                       <input
//                         type="number"
//                         name="riskAtLeast"
//                         min={0}
//                         max={100}
//                         className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
//                       />
//                     </div>

//                     <div>
//                       <label className="block text-xs font-medium text-slate-600">
//                         Repository criticality (optional)
//                       </label>
//                       <div className="mt-1 flex gap-3 text-xs">
//                         {CRITICALITY_LEVELS.map((level) => (
//                           <label key={level} className="flex items-center gap-1.5">
//                             <input type="checkbox" name="repositoryCriticalityIn" value={level} />
//                             {level}
//                           </label>
//                         ))}
//                       </div>
//                     </div>

//                     <div>
//                       <label className="block text-xs font-medium text-slate-600">Action</label>
//                       <select
//                         name="action"
//                         required
//                         defaultValue="REVIEW"
//                         className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
//                       >
//                         <option value="ALLOW">ALLOW</option>
//                         <option value="REVIEW">REVIEW</option>
//                         <option value="BLOCK">BLOCK</option>
//                       </select>
//                     </div>

//                     <div>
//                       <label className="block text-xs font-medium text-slate-600">
//                         Required approvals (comma-separated, optional)
//                       </label>
//                       <input
//                         type="text"
//                         name="requiredApprovals"
//                         placeholder="e.g. SECURITY_REVIEW, SENIOR_ENGINEER_REVIEW"
//                         className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
//                       />
//                     </div>

//                     <div>
//                       <label className="block text-xs font-medium text-slate-600">Reason (optional)</label>
//                       <input
//                         type="text"
//                         name="reason"
//                         className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
//                       />
//                     </div>

//                     <button
//                       type="submit"
//                       className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
//                     >
//                       Add Rule
//                     </button>
//                   </form>
//                 </details>
//               </CardContent>
//             </Card>
//           ))}
//         </div>
//       )}
//     </div>
//   );
// }
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { policyBadgeVariant } from "@/lib/badges";
import {
  getOrganizations,
  getSelectedOrganization,
  getPolicies,
  getCurrentUser,
  type PolicyRuleRecord,
} from "@/lib/api";
import { PolicySimulator } from "./policy-simulator";

const SENSITIVE_AREAS = [
  "AUTHENTICATION",
  "AUTHORIZATION",
  "PAYMENTS",
  "CRYPTOGRAPHY",
  "SECRETS",
  "DATABASE",
  "PERSONAL_DATA",
  "INFRASTRUCTURE",
  "NETWORKING",
  "API",
  "DEPENDENCIES",
  "CI_CD",
  "CONTAINERS",
  "LOGGING",
  "FRONTEND",
  "TESTING",
  "DOCUMENTATION",
] as const;

const CRITICALITY_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

/** Shared field set for both "Add rule" and "Edit rule" — only defaults/labels differ. */
function PolicyRuleFields({ existing }: { existing?: PolicyRuleRecord }) {
  return (
    <>
      <details className="rounded-md border border-slate-200 p-3 md:col-span-2">
        <summary className="cursor-pointer text-xs font-medium text-slate-700">
          Advanced nested conditions (optional)
        </summary>
        <p className="mt-2 text-xs text-slate-500">
          Enter a validated JSON condition tree. When set, it replaces the simple condition fields
          below. Use AND, OR, and NOT with AI_INVOLVEMENT, SENSITIVE_AREAS, RISK_SCORE, or
          REPOSITORY_CRITICALITY conditions.
        </p>
        <textarea
          name="conditionExpression"
          rows={8}
          defaultValue={
            existing?.conditionExpression
              ? JSON.stringify(existing.conditionExpression, null, 2)
              : ""
          }
          placeholder={`{
  "op": "AND",
  "conditions": [
    { "field": "AI_INVOLVEMENT", "equals": "YES" },
    {
      "op": "OR",
      "conditions": [
        { "field": "SENSITIVE_AREAS", "includes": ["PAYMENTS"] },
        { "field": "RISK_SCORE", "atLeast": 80 }
      ]
    }
  ]
}`}
          className="mt-2 w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-xs"
        />
      </details>

      <div>
        <label className="block text-xs font-medium text-slate-600">Rule name</label>
        <input
          type="text"
          name="name"
          required
          defaultValue={existing?.name}
          className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600">AI involvement</label>
        <select
          name="aiInvolved"
          defaultValue={
            existing?.aiInvolved === true ? "true" : existing?.aiInvolved === false ? "false" : ""
          }
          className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
        >
          <option value="">Any</option>
          <option value="true">Must be AI-involved</option>
          <option value="false">Confirmed not AI-involved</option>
        </select>
        <p className="mt-1 text-xs text-slate-500">
          Unknown provenance never counts as confirmed AI or non-AI. If it could satisfy this rule,
          evaluation falls back to REVIEW.
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600">Sensitive areas</label>
        <div className="mt-1 grid grid-cols-3 gap-1 text-xs">
          {SENSITIVE_AREAS.map((area) => (
            <label key={area} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                name="sensitiveAreas"
                value={area}
                defaultChecked={existing?.sensitiveAreas.includes(area)}
              />
              {area}
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600">
          Minimum risk score (optional)
        </label>
        <input
          type="number"
          name="riskAtLeast"
          min={0}
          max={100}
          defaultValue={existing?.riskAtLeast ?? undefined}
          className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600">
          Repository criticality (optional)
        </label>
        <div className="mt-1 flex gap-3 text-xs">
          {CRITICALITY_LEVELS.map((level) => (
            <label key={level} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                name="repositoryCriticalityIn"
                value={level}
                defaultChecked={existing?.repositoryCriticalityIn.includes(level)}
              />
              {level}
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600">Action</label>
        <select
          name="action"
          required
          defaultValue={existing?.action ?? "REVIEW"}
          className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
        >
          <option value="ALLOW">ALLOW</option>
          <option value="REVIEW">REVIEW</option>
          <option value="BLOCK">BLOCK</option>
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600">
          Required approvals (comma-separated, optional)
        </label>
        <input
          type="text"
          name="requiredApprovals"
          defaultValue={existing?.requiredApprovals.join(", ")}
          placeholder="e.g. SECURITY_REVIEW, SENIOR_ENGINEER_REVIEW"
          className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
        />
        <p className="mt-1 text-xs leading-5 text-slate-500">
          Supported: REVIEWER_REVIEW, ENGINEER_REVIEW, SENIOR_ENGINEER_REVIEW, PLATFORM_REVIEW,
          SECURITY_REVIEW. Senior engineer and platform gates map to ENGINEER; security gates map to
          SECURITY_ANALYST. Each gate needs a different reviewer.
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600">Reason (optional)</label>
        <input
          type="text"
          name="reason"
          defaultValue={existing?.reason ?? undefined}
          className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
        />
      </div>
    </>
  );
}

export default async function PoliciesPage({
  searchParams,
}: {
  searchParams: Promise<{ policyError?: string }>;
}) {
  const organizations = await getOrganizations();
  const selectedOrg = await getSelectedOrganization(organizations);

  if (!selectedOrg) {
    return null;
  }

  const { policyError } = await searchParams;
  const [policies, currentUser] = await Promise.all([
    getPolicies(selectedOrg.id),
    getCurrentUser(),
  ]);
  const canManagePolicies = ["OWNER", "ADMIN"].includes(selectedOrg.role.toUpperCase());

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
          Organization governance
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Policies</h1>
        <p className="mt-1 text-sm text-slate-500">{selectedOrg.name}</p>
      </div>

      {policyError && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {policyError}
        </div>
      )}

      <Card>
        <CardContent className="flex items-start gap-3 p-4 text-sm text-slate-700">
          <Badge variant="secondary">Platform defaults</Badge>
          <p>
            Built-in safeguards always apply alongside organization policies. The strongest matching
            action wins (BLOCK &gt; REVIEW &gt; ALLOW). ENFORCING policies remain in dry-run
            behavior until their current revision has the required independent approvals.
          </p>
        </CardContent>
      </Card>

      {selectedOrg.role.toUpperCase() === "OWNER" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Enforcement approval quorum</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              action="/api/policies/approval-quorum"
              method="POST"
              className="flex flex-wrap items-end gap-3"
            >
              <input type="hidden" name="organizationId" value={selectedOrg.id} />
              <div>
                <label className="block text-sm font-medium text-slate-700">
                  Required approvals
                </label>
                <select
                  name="policyApprovalQuorum"
                  defaultValue={selectedOrg.policyApprovalQuorum}
                  className="mt-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  {[1, 2, 3, 4, 5].map((quorum) => (
                    <option key={quorum} value={quorum}>
                      {quorum}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Save quorum
              </button>
              <p className="basis-full text-xs text-slate-500">
                Only distinct active owners and administrators count. The current revision author
                cannot approve it. Changing the quorum immediately recalculates enforcement status.
              </p>
            </form>
          </CardContent>
        </Card>
      )}

      {canManagePolicies && <PolicySimulator organizationId={selectedOrg.id} />}

      {canManagePolicies ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create organization policy</CardTitle>
          </CardHeader>
          <CardContent>
            <form action="/api/policies" method="POST" className="grid gap-4 md:grid-cols-2">
              <input type="hidden" name="organizationId" value={selectedOrg.id} />
              <div>
                <label className="block text-sm font-medium text-slate-700">Name</label>
                <input
                  type="text"
                  name="name"
                  required
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-100"
                  placeholder="e.g. Frontend Lockdown"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Enforcement mode</label>
                <select
                  name="mode"
                  defaultValue="DRY_RUN"
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="DRY_RUN">Dry run — record decisions, do not block</option>
                  <option value="ENFORCING">Enforcing — apply configured actions</option>
                  <option value="DISABLED">Disabled — policy has no effect</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-700">
                  Description <span className="font-normal text-slate-500">(optional)</span>
                </label>
                <input
                  type="text"
                  name="description"
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                />
              </div>
              <div className="md:col-span-2">
                <button
                  type="submit"
                  className="rounded-md bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700"
                >
                  Create policy
                </button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
          You can review policies, but only organization owners and administrators can change them.
        </div>
      )}

      {policies.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-slate-500">
              No organization-defined policies yet. Create a policy to add rules on top of the
              built-in safeguards.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {policies.map((policy) => (
            <Card key={policy.id}>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-base">{policy.name}</CardTitle>
                  {policy.description && (
                    <p className="mt-1 text-sm text-slate-500">{policy.description}</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Badge variant={policy.enabled ? "success" : "outline"}>
                    {policy.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                  <Badge variant={policy.mode === "ENFORCING" ? "warning" : "outline"}>
                    {policy.mode.replaceAll("_", " ")}
                  </Badge>
                  {canManagePolicies && (
                    <>
                      <form action={`/api/policies/${policy.id}/toggle`} method="POST">
                        <input type="hidden" name="organizationId" value={selectedOrg.id} />
                        <input type="hidden" name="enabled" value={(!policy.enabled).toString()} />
                        <button
                          type="submit"
                          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          {policy.enabled ? "Disable" : "Enable"}
                        </button>
                      </form>
                      <form action={`/api/policies/${policy.id}/delete`} method="POST">
                        <input type="hidden" name="organizationId" value={selectedOrg.id} />
                        <button
                          type="submit"
                          className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </form>
                    </>
                  )}
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                {policy.mode === "ENFORCING" && (
                  <div className="flex flex-wrap items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                    <Badge variant={policy.enforcementApproval.approved ? "success" : "warning"}>
                      {policy.enforcementApproval.approved
                        ? "Enforcement approved"
                        : "Approval pending"}
                    </Badge>
                    <span className="text-slate-600">
                      {policy.enforcementApproval.approvalCount} of{" "}
                      {policy.enforcementApproval.requiredApprovals} current approvals
                    </span>
                    {canManagePolicies &&
                      currentUser &&
                      !policy.enforcementApproval.approved &&
                      currentUser.id !== policy.enforcementApproval.revisionAuthorId &&
                      !policy.enforcementApproval.approverIds?.includes(currentUser.id) && (
                        <form action={`/api/policies/${policy.id}/approve`} method="POST">
                          <input type="hidden" name="organizationId" value={selectedOrg.id} />
                          <button
                            type="submit"
                            className="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-700"
                          >
                            Approve current revision
                          </button>
                        </form>
                      )}
                    <p className="basis-full text-xs text-slate-500">
                      Any policy or rule edit creates a new revision and requires new approvals.
                    </p>
                  </div>
                )}

                {canManagePolicies && (
                  <details className="rounded-md border border-slate-200 p-3">
                    <summary className="cursor-pointer text-sm font-medium text-slate-700">
                      Version history · {policy.version}
                    </summary>
                    {policy.revisions && policy.revisions.length > 0 ? (
                      <ul className="mt-3 space-y-2">
                        {policy.revisions.map((revision) => (
                          <li key={revision.id} className="rounded border border-slate-100 p-2">
                            <p className="text-xs font-semibold text-slate-700">
                              {revision.version} ·{" "}
                              <time dateTime={revision.createdAt}>
                                {new Date(revision.createdAt).toLocaleString()}
                              </time>
                            </p>
                            <details className="mt-1 text-xs text-slate-500">
                              <summary className="cursor-pointer">
                                View saved policy snapshot
                              </summary>
                              <pre className="mt-1 max-h-64 overflow-auto rounded bg-slate-50 p-2">
                                {JSON.stringify(revision.snapshot, null, 2)}
                              </pre>
                            </details>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-xs text-slate-500">
                        No historical snapshots are available yet. The next policy change will
                        create a versioned snapshot.
                      </p>
                    )}
                  </details>
                )}

                {canManagePolicies && (
                  <details className="rounded-md border border-slate-200 p-3">
                    <summary className="cursor-pointer text-sm font-medium text-slate-700">
                      Edit policy settings
                    </summary>
                    <form
                      action={`/api/policies/${policy.id}/edit`}
                      method="POST"
                      className="mt-3 grid gap-3 md:grid-cols-2"
                    >
                      <input type="hidden" name="organizationId" value={selectedOrg.id} />
                      <div>
                        <label className="block text-sm font-medium text-slate-700">Name</label>
                        <input
                          type="text"
                          name="name"
                          required
                          defaultValue={policy.name}
                          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700">
                          Enforcement mode
                        </label>
                        <select
                          name="mode"
                          defaultValue={policy.mode}
                          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                        >
                          <option value="DRY_RUN">Dry run</option>
                          <option value="ENFORCING">Enforcing</option>
                          <option value="DISABLED">Disabled</option>
                        </select>
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-slate-700">
                          Description
                        </label>
                        <input
                          type="text"
                          name="description"
                          defaultValue={policy.description ?? undefined}
                          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <button
                          type="submit"
                          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Save policy settings
                        </button>
                      </div>
                    </form>
                  </details>
                )}

                {policy.policyRules.length === 0 ? (
                  <p className="text-sm text-slate-400">
                    No rules yet — this policy has no effect.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {policy.policyRules.map((rule) => (
                      <li key={rule.id} className="rounded-md border border-slate-100 p-3 text-sm">
                        <div className="flex items-start justify-between">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-slate-900">{rule.name}</span>
                              <Badge variant={policyBadgeVariant(rule.action)}>{rule.action}</Badge>
                            </div>
                            <p className="text-xs text-slate-500">
                              {rule.conditionExpression ? (
                                "Nested condition expression · "
                              ) : (
                                <>
                                  {rule.aiInvolved === true && "AI-involved · "}
                                  {rule.aiInvolved === false && "Not AI-involved · "}
                                  {rule.sensitiveAreas.length > 0 &&
                                    `${rule.sensitiveAreas.join(", ")} · `}
                                  {rule.riskAtLeast != null && `risk ≥ ${rule.riskAtLeast} · `}
                                  {rule.repositoryCriticalityIn.length > 0 &&
                                    `repo: ${rule.repositoryCriticalityIn.join(", ")} · `}
                                </>
                              )}
                              {rule.requiredApprovals.length > 0 &&
                                `requires ${rule.requiredApprovals.join(", ")}`}
                            </p>
                            {rule.conditionExpression && (
                              <details className="text-xs text-slate-500">
                                <summary className="cursor-pointer">View nested conditions</summary>
                                <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-2">
                                  {JSON.stringify(rule.conditionExpression, null, 2)}
                                </pre>
                              </details>
                            )}
                            {rule.reason && <p className="text-xs text-slate-400">{rule.reason}</p>}
                          </div>
                          {canManagePolicies && (
                            <form
                              action={`/api/policies/${policy.id}/rules/${rule.id}/delete`}
                              method="POST"
                            >
                              <input type="hidden" name="organizationId" value={selectedOrg.id} />
                              <button
                                type="submit"
                                className="text-xs text-red-600 hover:underline"
                              >
                                Remove
                              </button>
                            </form>
                          )}
                        </div>

                        {canManagePolicies && (
                          <details className="mt-2">
                            <summary className="cursor-pointer text-xs font-medium text-slate-600">
                              Edit rule
                            </summary>
                            <form
                              action={`/api/policies/${policy.id}/rules/${rule.id}/edit`}
                              method="POST"
                              className="mt-3 space-y-3"
                            >
                              <input type="hidden" name="organizationId" value={selectedOrg.id} />
                              <PolicyRuleFields existing={rule} />
                              <button
                                type="submit"
                                className="rounded-md bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700"
                              >
                                Save rule
                              </button>
                            </form>
                          </details>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {canManagePolicies && (
                  <details className="rounded-md border border-slate-200 p-3">
                    <summary className="cursor-pointer text-sm font-medium text-slate-700">
                      Add rule
                    </summary>
                    <form
                      action={`/api/policies/${policy.id}/rules`}
                      method="POST"
                      className="mt-3 space-y-3"
                    >
                      <input type="hidden" name="organizationId" value={selectedOrg.id} />
                      <PolicyRuleFields />
                      <button
                        type="submit"
                        className="rounded-md bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700"
                      >
                        Add rule
                      </button>
                    </form>
                  </details>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
