import Link from "next/link";
import { ArrowUpRight, Menu, ShieldCheck } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { getCurrentUser, getOrganizations } from "@/lib/api";

export async function PublicHeader() {
  const user = await getCurrentUser();
  const organizations = user ? await getOrganizations() : [];
  const dashboardHref = organizations.length > 0 ? "/dashboard" : "/onboarding";
  const assessmentHref = organizations.length > 0 ? "/dashboard/assessment" : "/onboarding";

  return (
    <header className="site-header sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Nomalog home">
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-950 text-orange-300">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <span className="text-sm font-bold tracking-tight text-slate-950">
            Nomalog <span className="font-medium text-slate-500">Security &amp; governance</span>
          </span>
        </Link>
        <details className="group relative md:hidden">
          <summary
            aria-label="Open navigation menu"
            className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-md text-slate-700 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-600"
          >
            <Menu className="h-5 w-5" />
          </summary>
          <nav
            aria-label="Mobile navigation"
            className="absolute right-0 top-12 flex min-w-56 flex-col gap-1 rounded-lg border border-slate-200 bg-white p-2 shadow-xl"
          >
            <NavigationLinks
              isAuthenticated={Boolean(user)}
              dashboardHref={dashboardHref}
              assessmentHref={assessmentHref}
            />
          </nav>
        </details>
        <nav aria-label="Public navigation" className="hidden items-center gap-1 md:flex">
          <NavigationLinks
            isAuthenticated={Boolean(user)}
            dashboardHref={dashboardHref}
            assessmentHref={assessmentHref}
          />
        </nav>
      </div>
    </header>
  );
}

function NavigationLinks({
  isAuthenticated,
  dashboardHref,
  assessmentHref,
}: {
  isAuthenticated: boolean;
  dashboardHref: string;
  assessmentHref: string;
}) {
  return (
    <>
      <Link href="/product" className="nav-link">
        Platform
      </Link>
      <Link href="/how-it-works" className="nav-link">
        How it works
      </Link>
      <Link href="/pricing" className="nav-link">
        Pricing
      </Link>
      <Link href="/docs" className="nav-link">
        Docs
      </Link>
      <ThemeToggle />
      {isAuthenticated ? (
        <Link href={dashboardHref} className="nav-link">
          Dashboard
        </Link>
      ) : (
        <Link
          href="/api/auth/github/login?redirectTo=/dashboard"
          prefetch={false}
          className="nav-link"
        >
          Sign in
        </Link>
      )}
      <Link
        href={isAuthenticated ? assessmentHref : "/assessment"}
        className="inline-flex items-center justify-center gap-2 rounded-md bg-orange-600 px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600"
      >
        {isAuthenticated ? "Continue assessment" : "Free assessment"}{" "}
        <ArrowUpRight className="h-4 w-4" />
      </Link>
    </>
  );
}
