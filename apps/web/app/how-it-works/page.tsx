import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PublicShell } from "@/components/public-shell";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "Learn how Nomalog connects GitHub pull requests to available security, risk, policy, review, and evidence context.",
  alternates: { canonical: "/how-it-works" },
};

const stages = [
  [
    "Connect repositories",
    "Sign in with GitHub, create a workspace, install the Nomalog GitHub App, and choose which repositories to connect. GitHub organization administrators may need to approve the installation.",
  ],
  [
    "Assess code changes",
    "When a supported pull-request event arrives, Nomalog records the change and evaluates available metadata, changed-file context, and configured risk signals.",
  ],
  [
    "Review findings and evidence",
    "Inspect associated evidence, including CodeQL/Code Scanning results when configured and available for the current pull-request head. Missing or stale data is not a pass.",
  ],
  [
    "Evaluate policies",
    "Configured policies determine whether a change is allowed, requires review, or is blocked. Results depend on the active policy and integration data.",
  ],
  [
    "Record human decisions",
    "For review-required changes, an eligible member can be assigned and submit a decision. Review records are tied to the current commit and synchronized to the GitHub Check Run.",
  ],
  [
    "Monitor the workspace",
    "Use Changes, Evidence, Policies, Members, and repository views to inspect incoming work. Validate branch-protection behavior in a disposable repository before production enforcement.",
  ],
];

export default function HowItWorksPage() {
  return (
    <PublicShell>
      <main className="mx-auto max-w-5xl px-5 py-16 sm:px-8 sm:py-24">
        <p className="eyebrow">Workflow</p>
        <h1 className="page-title">From a GitHub event to a reviewable decision.</h1>
        <p className="page-lede">
          The Change Passport connects the data and decisions Nomalog actually receives for a pull
          request; it does not manufacture evidence a provider has not supplied.
        </p>
        <ol className="mt-10 space-y-4">
          {stages.map(([title, text], index) => (
            <li key={title} className="surface-card flex gap-5 p-5 sm:p-6">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-orange-50 font-mono text-sm text-orange-800">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <h2 className="text-lg font-semibold">{title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/assessment" className="button-primary">
            Start free assessment <ArrowRight className="h-4 w-4" />
          </Link>
          <Link href="/docs/quickstart" className="button-secondary">
            Read the setup guide
          </Link>
        </div>
      </main>
    </PublicShell>
  );
}
