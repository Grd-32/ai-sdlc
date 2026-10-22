import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Bot,
  FileCheck2,
  Gauge,
  GitPullRequest,
  ScanSearch,
  ShieldCheck,
} from "lucide-react";
import { PublicShell } from "@/components/public-shell";

export const metadata: Metadata = {
  title: "Platform",
  description:
    "Explore Nomalog's implemented GitHub change governance, human review, risk, and evidence workflows.",
  alternates: { canonical: "/product" },
};

const items = [
  {
    icon: GitPullRequest,
    title: "Change Passports",
    text: "A pull-request record brings available attribution, change context, risk, policy decision, reviewer state, and evidence together.",
  },
  {
    icon: Bot,
    title: "AI attribution signals",
    text: "Explicit declarations and recognized signals can be recorded. The product does not detect every AI tool or infer certainty from missing signals.",
  },
  {
    icon: Gauge,
    title: "Risk and policy",
    text: "Deterministic risk signals feed configurable policy evaluation and explainable ALLOW, REVIEW, or BLOCK outcomes.",
  },
  {
    icon: FileCheck2,
    title: "Human review",
    text: "Assign eligible organization members to review-required changes, record decisions against the current head commit, and synchronize GitHub checks.",
  },
  {
    icon: ScanSearch,
    title: "Security evidence",
    text: "Persisted evidence and GitHub Code Scanning results can be viewed alongside a change when the provider is configured and results are available.",
  },
  {
    icon: ShieldCheck,
    title: "Organization governance",
    text: "Manage organization members and roles, review audit events, and scope workspace views to the selected organization.",
  },
];

export default function ProductPage() {
  return (
    <PublicShell>
      <main className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-24">
        <p className="eyebrow">Platform overview</p>
        <h1 className="page-title">Connect the context around every code change.</h1>
        <p className="page-lede">
          Nomalog currently integrates with GitHub pull-request workflows. It helps teams review
          available change signals and decisions without presenting missing evidence as a pass.
        </p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map(({ icon: Icon, title, text }) => (
            <article className="surface-card p-6" key={title}>
              <Icon className="h-5 w-5 text-orange-700" />
              <h2 className="mt-4 text-lg font-semibold">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
            </article>
          ))}
        </div>
        <aside className="mt-10 rounded-md border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
          <strong>Current scope:</strong> Nomalog is not a general-purpose whole-repository scanner.
          Provider execution, GitHub permissions, and policy configuration affect what a workspace
          can show. See{" "}
          <Link className="font-semibold underline" href="/docs/security-evidence">
            security evidence setup
          </Link>{" "}
          and{" "}
          <Link className="font-semibold underline" href="/docs/data-lifecycle">
            data lifecycle details
          </Link>
          .
        </aside>
        <Link className="button-primary mt-8" href="/assessment">
          Start the free assessment <ArrowRight className="h-4 w-4" />
        </Link>
      </main>
    </PublicShell>
  );
}
