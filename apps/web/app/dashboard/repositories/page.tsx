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
import { Badge } from "@/components/ui/badge";
import { FolderGit2 } from "lucide-react";
import {
  getOrganizations,
  getSelectedOrganization,
  getRepositories,
  getInstallations,
} from "@/lib/api";
import { ProductEventLink } from "@/components/product-analytics";
import { GitLabRepositoryConnector } from "./gitlab-repository-connector";
import { ExternalSourceControlConnector } from "./external-source-control-connector";

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
  searchParams: Promise<{
    installed?: string;
    installError?: string;
    gitlabConnected?: string;
    gitlabError?: string;
    bitbucketConnected?: string;
    bitbucketError?: string;
    azureDevOpsConnected?: string;
    azureDevOpsError?: string;
  }>;
}) {
  const organizations = await getOrganizations();
  const selectedOrg = await getSelectedOrganization(organizations);

  if (!selectedOrg) {
    return null;
  }

  const {
    installed,
    installError,
    gitlabConnected,
    gitlabError,
    bitbucketConnected,
    bitbucketError,
    azureDevOpsConnected,
    azureDevOpsError,
  } = await searchParams;
  const canManageRepositories = ["OWNER", "ADMIN"].includes(selectedOrg.role.toUpperCase());
  const [repositories, installations] = await Promise.all([
    getRepositories(selectedOrg.id),
    canManageRepositories ? getInstallations(selectedOrg.id) : Promise.resolve([]),
  ]);
  const monitoredRepositories = repositories.filter(
    (repository) => repository.enabled && repository.provider === "GITHUB",
  ).length;
  const hasActiveInstallation = installations.some((installation) => installation.active);

  // NEXT_PUBLIC_ vars are inlined at Next.js BUILD time, not read at
  // container runtime — see the note in the delivery message about
  // apps/web/Dockerfile needing this passed as a build ARG, or this will
  // silently be undefined regardless of what's in docker-compose.yml's
  // `environment:` block.
  const appSlug = process.env["NEXT_PUBLIC_GITHUB_APP_SLUG"];
  const installUrl =
    appSlug && canManageRepositories
      ? `/api/github/installations/start?organizationId=${encodeURIComponent(selectedOrg.id)}`
      : undefined;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            Source control
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
            Repositories
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {selectedOrg.name} · {repositories.length} associated · {monitoredRepositories} GitHub
            repositories monitored
          </p>
        </div>
        {installUrl ? (
          <ProductEventLink
            href={installUrl}
            event="repository_integration_started"
            className="rounded-md bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700"
          >
            {hasActiveInstallation ? "Manage GitHub access" : "Install GitHub App"}
          </ProductEventLink>
        ) : !appSlug ? (
          <p className="max-w-sm text-right text-sm text-amber-800">
            GitHub App installation is not configured. Set{" "}
            <code className="rounded bg-amber-50 px-1">NEXT_PUBLIC_GITHUB_APP_SLUG</code> in `.env`
            and rebuild the web service.
          </p>
        ) : (
          <p className="max-w-sm text-right text-sm text-slate-600">
            Organization admin access is required to install the GitHub App.
          </p>
        )}
      </div>

      {installed && (
        <div
          role="status"
          className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          GitHub App installation connected successfully.
        </div>
      )}
      {installError && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {installErrorMessage(installError)}
        </div>
      )}

      <GitLabRepositoryConnector
        organizationId={selectedOrg.id}
        canManage={canManageRepositories}
        connected={gitlabConnected === "1"}
        errorCode={gitlabError}
      />
      <ExternalSourceControlConnector
        provider="BITBUCKET"
        organizationId={selectedOrg.id}
        canManage={canManageRepositories}
        connected={bitbucketConnected === "1"}
        errorCode={bitbucketError}
      />
      <ExternalSourceControlConnector
        provider="AZURE_DEVOPS"
        organizationId={selectedOrg.id}
        canManage={canManageRepositories}
        connected={azureDevOpsConnected === "1"}
        errorCode={azureDevOpsError}
      />

      <Card>
        <CardContent className="p-0">
          {repositories.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <FolderGit2 className="mx-auto h-8 w-8 text-slate-400" />
              <p className="mt-3 text-sm font-semibold text-slate-900">No repositories connected</p>
              <p className="mx-auto mt-1 max-w-lg text-sm text-slate-500">
                Install the GitHub App on an organization or account, then select repositories to
                bring pull requests, risk assessments, and policy decisions into this workspace.
              </p>
              {installUrl && (
                <ProductEventLink
                  href={installUrl}
                  event="repository_integration_started"
                  className="mt-4 inline-flex rounded-md bg-orange-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-orange-700"
                >
                  Install GitHub App
                </ProductEventLink>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[700px] w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">Repository</th>
                    <th className="px-5 py-3 font-medium">Criticality</th>
                    <th className="px-5 py-3 font-medium">Pull requests</th>
                    <th className="px-5 py-3 font-medium">Integration status</th>
                  </tr>
                </thead>
                <tbody>
                  {repositories.map((repo) => (
                    <tr key={repo.id} className="border-t border-slate-200 hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2 font-medium text-slate-900">
                          <FolderGit2 className="h-4 w-4 text-slate-500" />
                          {repo.owner}/{repo.name}
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <Badge variant="outline">{repo.criticality}</Badge>
                      </td>
                      <td className="px-5 py-3 tabular-nums text-slate-600">
                        {repo._count.pullRequests}
                      </td>
                      <td className="px-5 py-3">
                        <Badge
                          variant={
                            repo.provider === "GITHUB" && repo.enabled ? "success" : "outline"
                          }
                        >
                          {!repo.enabled
                            ? "Paused"
                            : repo.provider === "GITHUB"
                              ? "Monitoring"
                              : `${repo.provider} selected · analysis unavailable`}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
