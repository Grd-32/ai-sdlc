// import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
// import { Badge } from "@/components/ui/badge";
// import { getPublicApiUrl } from "@/lib/utils";
// import {
//   getOrganizations,
//   getSelectedOrganization,
//   getCurrentUser,
//   getInstallations,
//   getAuditEvents,
// } from "@/lib/api";

// export default async function SettingsPage() {
//   const organizations = await getOrganizations();
//   const selectedOrg = await getSelectedOrganization(organizations);
//   const user = await getCurrentUser();

//   if (!selectedOrg) {
//     return null;
//   }

//   // Installations require ADMIN+, audit events require AUDITOR+ (see
//   // routes/settings.ts) — a user below those roles will see empty sections
//   // here rather than a "you don't have permission" message. Known,
//   // acceptable-for-now UX gap: apiFetch collapses a 403 into the same
//   // `data: null` shape as "no rows exist yet", so this page can't currently
//   // tell those two cases apart. Worth a proper fix if this proves confusing
//   // in practice.
//   const [installations, auditEvents] = await Promise.all([
//     getInstallations(selectedOrg.id),
//     getAuditEvents(selectedOrg.id),
//   ]);

//   return (
//     <div className="mx-auto max-w-3xl space-y-6">
//       <div>
//         <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
//         <p className="text-sm text-slate-500">{selectedOrg.name}</p>
//       </div>

//       <Card>
//         <CardHeader>
//           <CardTitle className="text-base">Account</CardTitle>
//         </CardHeader>
//         <CardContent className="flex items-center justify-between">
//           <p className="text-sm text-slate-600">Signed in as {user?.name ?? user?.username ?? user?.email}</p>
//           <a
//             href={`${getPublicApiUrl()}/api/auth/logout`}
//             className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
//           >
//             Sign out
//           </a>
//         </CardContent>
//       </Card>

//       <Card>
//         <CardHeader>
//           <CardTitle className="text-base">GitHub Installations</CardTitle>
//         </CardHeader>
//         <CardContent className="p-0">
//           {installations.length === 0 ? (
//             <p className="p-6 text-sm text-slate-500">
//               No GitHub App installations connected. Connect one from the{" "}
//               <a href="/dashboard/repositories" className="underline">
//                 Repositories
//               </a>{" "}
//               page.
//             </p>
//           ) : (
//             <table className="w-full text-left text-sm">
//               <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
//                 <tr>
//                   <th className="px-4 py-3 font-medium">Account</th>
//                   <th className="px-4 py-3 font-medium">Type</th>
//                   <th className="px-4 py-3 font-medium">Status</th>
//                   <th className="px-4 py-3 font-medium">Connected</th>
//                 </tr>
//               </thead>
//               <tbody>
//                 {installations.map((inst) => (
//                   <tr key={inst.id} className="border-b border-slate-100 last:border-0">
//                     <td className="px-4 py-3 font-medium text-slate-900">{inst.accountLogin ?? "—"}</td>
//                     <td className="px-4 py-3 text-slate-600">{inst.accountType ?? "—"}</td>
//                     <td className="px-4 py-3">
//                       <Badge variant={inst.active ? "success" : "outline"}>
//                         {inst.active ? "Active" : "Removed"}
//                       </Badge>
//                     </td>
//                     <td className="px-4 py-3 text-slate-500">{new Date(inst.createdAt).toLocaleDateString()}</td>
//                   </tr>
//                 ))}
//               </tbody>
//             </table>
//           )}
//         </CardContent>
//       </Card>

//       <Card>
//         <CardHeader>
//           <CardTitle className="text-base">Policies</CardTitle>
//         </CardHeader>
//         <CardContent>
//           <p className="text-sm text-slate-500">
//             AI-assisted changes are currently evaluated against the platform&apos;s built-in default
//             rules (payments, secrets, authentication, infrastructure, high risk). Organization-defined
//             policies aren&apos;t wired into the evaluation engine yet — creating one here wouldn&apos;t
//             actually change how changes get evaluated, so that&apos;s intentionally not built until it
//             is. See{" "}
//             <a href="/dashboard/policies" className="underline">
//               Policies
//             </a>{" "}
//             for the current rule set.
//           </p>
//         </CardContent>
//       </Card>

//       <Card>
//         <CardHeader>
//           <CardTitle className="text-base">Audit Log</CardTitle>
//         </CardHeader>
//         <CardContent className="p-0">
//           {auditEvents.length === 0 ? (
//             <p className="p-6 text-sm text-slate-500">No audit events recorded yet.</p>
//           ) : (
//             <table className="w-full text-left text-sm">
//               <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
//                 <tr>
//                   <th className="px-4 py-3 font-medium">Event</th>
//                   <th className="px-4 py-3 font-medium">Actor</th>
//                   <th className="px-4 py-3 font-medium">When</th>
//                 </tr>
//               </thead>
//               <tbody>
//                 {auditEvents.map((event) => (
//                   <tr key={event.id} className="border-b border-slate-100 last:border-0">
//                     <td className="px-4 py-3 font-medium text-slate-900">{event.eventType}</td>
//                     <td className="px-4 py-3 text-slate-600">{event.actor ?? "System"}</td>
//                     <td className="px-4 py-3 text-slate-500">{new Date(event.createdAt).toLocaleString()}</td>
//                   </tr>
//                 ))}
//               </tbody>
//             </table>
//           )}
//         </CardContent>
//       </Card>
//     </div>
//   );
// }
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getPublicApiUrl } from "@/lib/utils";
import {
  getOrganizations,
  getSelectedOrganization,
  getCurrentUser,
  getInstallations,
  getAuditEvents,
} from "@/lib/api";

export default async function SettingsPage() {
  const organizations = await getOrganizations();
  const selectedOrg = await getSelectedOrganization(organizations);
  const user = await getCurrentUser();

  if (!selectedOrg) {
    return null;
  }

  // Installations require ADMIN+, audit events require AUDITOR+ (see
  // routes/settings.ts) — a user below those roles will see empty sections
  // here rather than a "you don't have permission" message. Known,
  // acceptable-for-now UX gap: apiFetch collapses a 403 into the same
  // `data: null` shape as "no rows exist yet", so this page can't currently
  // tell those two cases apart. Worth a proper fix if this proves confusing
  // in practice.
  const [installations, auditEvents] = await Promise.all([
    getInstallations(selectedOrg.id),
    getAuditEvents(selectedOrg.id),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500">{selectedOrg.name}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <p className="text-sm text-slate-600">Signed in as {user?.name ?? user?.username ?? user?.email}</p>
          <a
            href={`${getPublicApiUrl()}/api/auth/logout`}
            className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Sign out
          </a>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">GitHub Installations</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {installations.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">
              No GitHub App installations connected. Connect one from the{" "}
              <a href="/dashboard/repositories" className="underline">
                Repositories
              </a>{" "}
              page.
            </p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Account</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Connected</th>
                </tr>
              </thead>
              <tbody>
                {installations.map((inst) => (
                  <tr key={inst.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3 font-medium text-slate-900">{inst.accountLogin ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{inst.accountType ?? "—"}</td>
                    <td className="px-4 py-3">
                      <Badge variant={inst.active ? "success" : "outline"}>
                        {inst.active ? "Active" : "Removed"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{new Date(inst.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Policies</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500">
            AI-assisted changes are evaluated against the platform&apos;s built-in default rules
            (payments, secrets, authentication, infrastructure, high risk), plus any
            organization-defined policies you&apos;ve created — both are applied together, with the
            strongest matching action (BLOCK &gt; REVIEW &gt; ALLOW) winning. There&apos;s no policy
            editor here yet; policies can currently only be managed via the API. See{" "}
            <a href="/dashboard/policies" className="underline">
              Policies
            </a>{" "}
            for the current rule set.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Audit Log</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {auditEvents.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No audit events recorded yet.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Event</th>
                  <th className="px-4 py-3 font-medium">Actor</th>
                  <th className="px-4 py-3 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {auditEvents.map((event) => (
                  <tr key={event.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3 font-medium text-slate-900">{event.eventType}</td>
                    <td className="px-4 py-3 text-slate-600">{event.actor ?? "System"}</td>
                    <td className="px-4 py-3 text-slate-500">{new Date(event.createdAt).toLocaleString()}</td>
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