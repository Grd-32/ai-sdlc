// import { Card, CardContent } from "@/components/ui/card";
// import { getOrganizations, getSelectedOrganization, getRepositories } from "@/lib/api";

// export default async function RepositoriesPage() {
//   const organizations = await getOrganizations();
//   const selectedOrg = await getSelectedOrganization(organizations);

//   if (!selectedOrg) {
//     return null;
//   }

//   const repositories = await getRepositories(selectedOrg.id);

//   return (
//     <div>
//       <div className="mb-6">
//         <h1 className="text-2xl font-semibold text-slate-900">Repositories</h1>
//         <p className="text-sm text-slate-500">{selectedOrg.name}</p>
//       </div>

//       <Card>
//         <CardContent className="p-0">
//           {repositories.length === 0 ? (
//             <p className="p-6 text-sm text-slate-500">No repositories enabled yet.</p>
//           ) : (
//             <table className="w-full text-left text-sm">
//               <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
//                 <tr>
//                   <th className="px-4 py-3 font-medium">Repository</th>
//                   <th className="px-4 py-3 font-medium">Criticality</th>
//                   <th className="px-4 py-3 font-medium">Pull Requests</th>
//                   <th className="px-4 py-3 font-medium">Monitoring</th>
//                 </tr>
//               </thead>
//               <tbody>
//                 {repositories.map((repo) => (
//                   <tr key={repo.id} className="border-b border-slate-100 last:border-0">
//                     <td className="px-4 py-3 font-medium text-slate-900">
//                       {repo.owner}/{repo.name}
//                     </td>
//                     <td className="px-4 py-3 text-slate-600">{repo.criticality}</td>
//                     <td className="px-4 py-3 text-slate-600">{repo._count.pullRequests}</td>
//                     <td className="px-4 py-3">
//                       <span
//                         className={`inline-block h-2 w-2 rounded-full ${
//                           repo.enabled ? "bg-emerald-500" : "bg-slate-300"
//                         }`}
//                         title={repo.enabled ? "Monitoring enabled" : "Monitoring disabled"}
//                       />
//                     </td>
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
import { Card, CardContent } from "@/components/ui/card";
import { getOrganizations, getSelectedOrganization, getRepositories } from "@/lib/api";

function installErrorMessage(code: string): string {
  switch (code) {
    case "missing_installation_id":
      return "GitHub didn't return an installation ID. Try installing again.";
    case "missing_organization":
      return "GitHub did not return the organization context. Start the install again from this page.";
    case "sign_in_required":
      return "Sign in again before connecting the GitHub App.";
    case "forbidden":
      return "You need admin access to this organization to connect a GitHub installation.";
    case "app_not_configured":
      return "GitHub App installation is not configured. Set NEXT_PUBLIC_GITHUB_APP_SLUG and rebuild the web service.";
    case "github_fetch_failed":
      return "Couldn't fetch installation details from GitHub. Try again in a moment.";
    case "repository_sync_failed":
      return "The GitHub App is linked, but repository synchronization failed. Try the setup flow again.";
    default:
      return "Something went wrong connecting the GitHub App.";
  }
}

export default async function RepositoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ installed?: string; installError?: string }>;
}) {
  const organizations = await getOrganizations();
  const selectedOrg = await getSelectedOrganization(organizations);

  if (!selectedOrg) {
    return null;
  }

  const { installed, installError } = await searchParams;
  const repositories = await getRepositories(selectedOrg.id);

  // NEXT_PUBLIC_ vars are inlined at Next.js BUILD time, not read at
  // container runtime — see the note in the delivery message about
  // apps/web/Dockerfile needing this passed as a build ARG, or this will
  // silently be undefined regardless of what's in docker-compose.yml's
  // `environment:` block.
  const appSlug = process.env["NEXT_PUBLIC_GITHUB_APP_SLUG"];
  const installUrl = appSlug
    ? `/api/github/installations/start?organizationId=${encodeURIComponent(selectedOrg.id)}`
    : undefined;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Repositories</h1>
          <p className="text-sm text-slate-500">{selectedOrg.name}</p>
        </div>
        {installUrl ? (
          <a
            href={installUrl}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Install GitHub App
          </a>
        ) : (
          <p className="max-w-sm text-right text-sm text-amber-800">
            GitHub App installation is not configured. Set{" "}
            <code className="rounded bg-amber-50 px-1">NEXT_PUBLIC_GITHUB_APP_SLUG</code> in `.env`
            and rebuild the web service.
          </p>
        )}
      </div>

      {installed && (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          GitHub App installation connected successfully.
        </div>
      )}
      {installError && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {installErrorMessage(installError)}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {repositories.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">
              No repositories enabled yet.
              {installUrl && (
                <>
                  {" "}
                  <a href={installUrl} className="text-slate-900 underline">
                    Install the GitHub App
                  </a>{" "}
                  to connect one.
                </>
              )}
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Repository</th>
                  <th className="px-4 py-3 font-medium">Criticality</th>
                  <th className="px-4 py-3 font-medium">Pull Requests</th>
                  <th className="px-4 py-3 font-medium">Monitoring</th>
                </tr>
              </thead>
              <tbody>
                {repositories.map((repo) => (
                  <tr key={repo.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {repo.owner}/{repo.name}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{repo.criticality}</td>
                    <td className="px-4 py-3 text-slate-600">{repo._count.pullRequests}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${
                          repo.enabled ? "bg-emerald-500" : "bg-slate-300"
                        }`}
                        title={repo.enabled ? "Monitoring enabled" : "Monitoring disabled"}
                      />
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
