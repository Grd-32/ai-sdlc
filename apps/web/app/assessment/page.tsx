import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, CircleAlert, KeyRound } from "lucide-react";
import { PublicShell } from "@/components/public-shell";
import { ProductEventLink } from "@/components/product-analytics";
import {
  getAssessments,
  getCurrentUser,
  getOrganizations,
  getSelectedOrganization,
} from "@/lib/api";

export const metadata: Metadata = {
  title: "Free AI Risk Assessment",
  description:
    "Select connected GitHub repositories and generate a persisted, evidence-linked assessment of available pull-request activity from the previous 30 days.",
  alternates: { canonical: "/assessment" },
};

export default async function AssessmentPage() {
  const user = await getCurrentUser();
  const organizations = user ? await getOrganizations() : [];
  const organization = user ? await getSelectedOrganization(organizations) : null;
  const assessments = organization ? await getAssessments(organization.id) : [];
  const assessmentHref = organization ? "/dashboard/assessment" : "/onboarding";
  const assessmentLabel = assessments.length > 0 ? "Continue assessment" : "Start free assessment";

  return (
    <PublicShell>
      <main className="mx-auto max-w-7xl px-5 py-14 sm:px-8 sm:py-20">
        <div className="grid gap-12 lg:grid-cols-[1fr_0.72fr]">
          <div>
            <p className="eyebrow">No-cost first assessment · GitHub workflow</p>
            <h1 className="page-title">Assess 30 days of repository and pull-request activity.</h1>
            <p className="page-lede">
              Choose the connected repositories to include. Nomalog runs the selected pull requests
              through its existing risk, policy, evidence, and provenance pipeline and saves a
              report with the coverage and limitations shown.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {user ? (
                <Link href={assessmentHref} className="button-primary">
                  {assessmentLabel} <ArrowRight className="h-4 w-4" />
                </Link>
              ) : (
                <ProductEventLink
                  href="/api/auth/github/login?redirectTo=/onboarding"
                  event="signup_started"
                  className="button-primary"
                >
                  Continue with GitHub <ArrowRight className="h-4 w-4" />
                </ProductEventLink>
              )}
              <Link href="/docs/quickstart" className="button-secondary">
                Read setup steps
              </Link>
            </div>
            <p className="mt-4 text-xs text-slate-500">
              Sign in, create or select a workspace, connect GitHub, then open Risk assessment to
              choose the exact repositories. Organization administrators can start a report.
            </p>
          </div>
          <aside className="surface-card p-6 sm:p-7">
            <h2 className="text-lg font-semibold">What the assessment covers</h2>
            <ul className="mt-5 space-y-4 text-sm leading-6 text-slate-600">
              {[
                "Pull requests updated in the previous 30 days, their changed-file metadata and available diffs.",
                "Deterministic risk-v2 scores and factor breakdowns using available findings and evidence.",
                "Current policy decisions, configured review coverage, and recorded AI provenance.",
                "GitHub Code Scanning and current GitHub Secret Scanning alerts when available.",
                "A private, persisted report with traceable findings, progress, export, retry, and cancellation.",
              ].map((text) => (
                <li key={text} className="flex gap-3">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                  {text}
                </li>
              ))}
            </ul>
          </aside>
        </div>

        <div className="mt-12 grid gap-4 md:grid-cols-2">
          <section className="rounded-md border border-slate-200 bg-white p-6">
            <h2 className="flex items-center gap-2 font-semibold">
              <KeyRound className="h-4 w-4 text-orange-700" />
              Scope and permissions
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              The assessment uses the existing GitHub App installation and only the repositories
              explicitly selected in Nomalog. The assessment performs read-only requests; review the
              installed App permissions in GitHub. No write permission is requested just to generate
              this report. Read the{" "}
              <Link href="/docs/github" className="font-semibold text-orange-800 underline">
                GitHub integration guide
              </Link>{" "}
              before approval. Some sections require optional permissions or enabled provider
              features; unavailable sections are identified as NOT RUN or UNKNOWN.
            </p>
          </section>
          <section className="rounded-md border border-amber-200 bg-amber-50 p-6">
            <h2 className="flex items-center gap-2 font-semibold text-amber-950">
              <CircleAlert className="h-4 w-4" />
              Important limits
            </h2>
            <p className="mt-3 text-sm leading-6 text-amber-950">
              The 30-day scope is based on available GitHub pull-request activity, not a complete
              historical record of all repository security events. Source code is not executed. Diff
              hunks may be sent to Azure AI Foundry if that optional review is enabled. Assessment
              reports expire after 90 days; existing organization evidence follows its own
              retention. Missing evidence never means clean, and the risk score is not a
              certification or industry benchmark.
            </p>
          </section>
        </div>
      </main>
    </PublicShell>
  );
}
