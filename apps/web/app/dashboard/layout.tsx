// import Link from "next/link";
// import { redirect } from "next/navigation";
// import {
//   Shield,
//   LayoutDashboard,
//   GitPullRequest,
//   Bot,
//   FolderGit2,
//   ShieldCheck,
//   FileSearch,
//   Settings,
// } from "lucide-react";
// import { getPublicApiUrl } from "@/lib/utils";
// import { getCurrentUser, getOrganizations, getSelectedOrganization } from "@/lib/api";

// // README §42 nav. AI Agents needs a new backend aggregation endpoint
// // (group-by-agent across the org, not a simple list — doesn't exist yet).
// // Settings has no spec to build against yet. Both render as inert
// // "coming soon" rows rather than dead links until then.
// const NAV_ITEMS = [
//   { label: "Overview", href: "/dashboard", icon: LayoutDashboard, available: true },
//   { label: "Changes", href: "/dashboard/changes", icon: GitPullRequest, available: true },
//   { label: "AI Agents", href: "/dashboard/agents", icon: Bot, available: false },
//   { label: "Repositories", href: "/dashboard/repositories", icon: FolderGit2, available: true },
//   { label: "Policies", href: "/dashboard/policies", icon: ShieldCheck, available: true },
//   { label: "Evidence", href: "/dashboard/evidence", icon: FileSearch, available: true },
//   { label: "Settings", href: "/dashboard/settings", icon: Settings, available: false },
// ] as const;

// export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
//   const user = await getCurrentUser();

//   if (!user) {
//     // Must be the browser-facing URL — this redirect() sends an HTTP
//     // Location header to the browser, which cannot resolve the
//     // Docker-internal "api" hostname. See getPublicApiUrl()'s doc comment.
//     // redirectTo tells the OAuth callback to send the browser back here
//     // afterward instead of defaulting to the bare app root.
//     redirect(`${getPublicApiUrl()}/api/auth/github/login?redirectTo=/dashboard`);
//   }

//   const organizations = await getOrganizations();

//   if (organizations.length === 0) {
//     return (
//       <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
//         <div className="max-w-md text-center">
//           <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900 text-white">
//             <Shield className="h-6 w-6" />
//           </div>
//           <h1 className="text-xl font-semibold text-slate-900">No organizations yet</h1>
//           <p className="mt-2 text-sm text-slate-600">
//             {user.name ?? user.username ?? user.email} isn&apos;t a member of any organization in
//             AI-SDLC Control Plane yet. Ask an administrator to add you.
//           </p>
//         </div>
//       </main>
//     );
//   }

//   const selectedOrg = await getSelectedOrganization(organizations);

//   return (
//     <div className="flex min-h-screen bg-slate-50">
//       <aside className="flex w-64 flex-col border-r border-slate-200 bg-white">
//         <div className="flex items-center gap-2 px-6 py-5">
//           <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white">
//             <Shield className="h-4 w-4" />
//           </div>
//           <span className="font-semibold text-slate-900">AI-SDLC</span>
//         </div>

//         {organizations.length > 1 ? (
//           <div className="border-b border-slate-200 px-4 pb-4">
//             <p className="mb-2 px-2 text-xs font-medium uppercase tracking-wide text-slate-400">
//               Organization
//             </p>
//             <div className="space-y-1">
//               {organizations.map((org) => (
//                 <a
//                   key={org.id}
//                   href={`/api/select-organization?org=${org.id}`}
//                   className={`block rounded-md px-2 py-1.5 text-sm ${
//                     org.id === selectedOrg?.id
//                       ? "bg-slate-100 font-medium text-slate-900"
//                       : "text-slate-600 hover:bg-slate-50"
//                   }`}
//                 >
//                   {org.name}
//                 </a>
//               ))}
//             </div>
//           </div>
//         ) : (
//           <div className="border-b border-slate-200 px-6 pb-4 text-sm font-medium text-slate-700">
//             {selectedOrg?.name}
//           </div>
//         )}

//         <nav className="flex-1 space-y-1 px-4 py-4">
//           {NAV_ITEMS.map((item) => {
//             const Icon = item.icon;
//             if (!item.available) {
//               return (
//                 <div
//                   key={item.label}
//                   className="flex cursor-not-allowed items-center gap-3 rounded-md px-2 py-2 text-sm text-slate-300"
//                   title="Coming soon"
//                 >
//                   <Icon className="h-4 w-4" />
//                   {item.label}
//                 </div>
//               );
//             }
//             return (
//               <Link
//                 key={item.label}
//                 href={item.href}
//                 className="flex items-center gap-3 rounded-md px-2 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
//               >
//                 <Icon className="h-4 w-4" />
//                 {item.label}
//               </Link>
//             );
//           })}
//         </nav>

//         <div className="border-t border-slate-200 px-6 py-4 text-xs text-slate-500">
//           Signed in as {user.name ?? user.username ?? user.email}
//         </div>
//       </aside>

//       <div className="flex-1 px-8 py-8">{children}</div>
//     </div>
//   );
// }
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Shield,
  LayoutDashboard,
  GitPullRequest,
  Bot,
  FolderGit2,
  ShieldCheck,
  FileSearch,
  Settings,
  Gauge,
} from "lucide-react";
import { getCurrentUser, getOrganizations, getSelectedOrganization } from "@/lib/api";

const NAV_ITEMS = [
  { label: "Overview", href: "/dashboard", icon: LayoutDashboard, available: true },
  { label: "Changes", href: "/dashboard/changes", icon: GitPullRequest, available: true },
  { label: "AI Agents", href: "/dashboard/agents", icon: Bot, available: true },
  { label: "Repositories", href: "/dashboard/repositories", icon: FolderGit2, available: true },
  { label: "Policies", href: "/dashboard/policies", icon: ShieldCheck, available: true },
  { label: "Evidence", href: "/dashboard/evidence", icon: FileSearch, available: true },
  { label: "Admin", href: "/dashboard/admin", icon: Gauge, available: true },
  { label: "Settings", href: "/dashboard/settings", icon: Settings, available: true },
] as const;

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/api/auth/github/login?redirectTo=/dashboard");
  }

  const organizations = await getOrganizations();

  if (organizations.length === 0) {
    redirect("/onboarding");
  }

  const selectedOrg = await getSelectedOrganization(organizations);

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="flex w-64 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center gap-2 px-6 py-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white">
            <Shield className="h-4 w-4" />
          </div>
          <span className="font-semibold text-slate-900">AI-SDLC</span>
        </div>

        {organizations.length > 1 ? (
          <div className="border-b border-slate-200 px-4 pb-4">
            <p className="mb-2 px-2 text-xs font-medium uppercase tracking-wide text-slate-400">
              Organization
            </p>
            <div className="space-y-1">
              {organizations.map((org) => (
                <a
                  key={org.id}
                  href={`/api/select-organization?org=${org.id}`}
                  className={`block rounded-md px-2 py-1.5 text-sm ${
                    org.id === selectedOrg?.id
                      ? "bg-slate-100 font-medium text-slate-900"
                      : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {org.name}
                </a>
              ))}
            </div>
          </div>
        ) : (
          <div className="border-b border-slate-200 px-6 pb-4 text-sm font-medium text-slate-700">
            {selectedOrg?.name}
          </div>
        )}

        <nav className="flex-1 space-y-1 px-4 py-4">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.label}
                href={item.href}
                className="flex items-center gap-3 rounded-md px-2 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 px-6 py-4 text-xs text-slate-500">
          Signed in as {user.name ?? user.username ?? user.email}
        </div>
      </aside>

      <div className="flex-1 px-8 py-8">{children}</div>
    </div>
  );
}
