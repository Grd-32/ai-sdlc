"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  Bell,
  BarChart3,
  CreditCard,
  FileSearch,
  FolderGit2,
  Gauge,
  GitPullRequest,
  LayoutDashboard,
  ListChecks,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";

const NAV_GROUPS = [
  {
    label: "Workspace",
    items: [
      { label: "Overview", href: "/dashboard", icon: LayoutDashboard },
      { label: "Risk assessment", href: "/dashboard/assessment", icon: Gauge },
      { label: "Changes", href: "/dashboard/changes", icon: GitPullRequest },
      { label: "Findings", href: "/dashboard/findings", icon: ListChecks },
      { label: "Analytics", href: "/dashboard/analytics", icon: BarChart3 },
      { label: "Repositories", href: "/dashboard/repositories", icon: FolderGit2 },
      { label: "AI agents", href: "/dashboard/agents", icon: Bot },
    ],
  },
  {
    label: "Governance",
    items: [
      { label: "Policies", href: "/dashboard/policies", icon: ShieldCheck },
      { label: "Evidence", href: "/dashboard/evidence", icon: FileSearch },
      { label: "Notifications", href: "/dashboard/notifications", icon: Bell },
      { label: "Administration", href: "/dashboard/admin", icon: Gauge },
      { label: "Members", href: "/dashboard/members", icon: Users },
      { label: "Billing", href: "/dashboard/billing", icon: CreditCard },
      { label: "Settings", href: "/dashboard/settings", icon: Settings },
    ],
  },
] as const;

export function DashboardNavigation() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main navigation"
      className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2 lg:block lg:w-60 lg:flex-none lg:space-y-6 lg:overflow-visible lg:border-b-0 lg:border-r lg:px-3 lg:py-5"
    >
      {NAV_GROUPS.map((group) => (
        <div key={group.label} className="flex flex-none gap-1 lg:block">
          <p className="hidden px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400 lg:block">
            {group.label}
          </p>
          <div className="flex gap-1 lg:block lg:space-y-1">
            {group.items.map((item) => {
              const Icon = item.icon;
              const active =
                item.href === "/dashboard"
                  ? pathname === item.href
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-9 items-center gap-3 whitespace-nowrap rounded-md border-l-2 px-3 py-2 text-sm font-medium transition-colors ${
                    active
                      ? "border-orange-600 bg-orange-50 text-orange-800"
                      : "border-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  <Icon className={`h-4 w-4 ${active ? "text-orange-700" : "text-slate-500"}`} />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
