import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight,
  BookOpen,
  GitBranch,
  LayoutDashboard,
  ShieldCheck,
  Users,
  Workflow,
} from "lucide-react";
import { DocsFrame } from "@/components/docs-frame";
import { DOCS_GROUPS } from "@/lib/product-docs";

export const metadata: Metadata = {
  title: "Documentation",
  description:
    "Nomalog product guides for onboarding, GitHub integrations, policy, evidence, members, and human reviews.",
  alternates: { canonical: "/docs" },
};

const ICONS: Record<string, typeof BookOpen> = {
  "Start here": BookOpen,
  Dashboard: LayoutDashboard,
  "Organization access": Users,
  Product: Workflow,
  Integrations: GitBranch,
  "Trust & operations": ShieldCheck,
};

export default function DocumentationHome() {
  return (
    <DocsFrame>
      <div className="border-b border-slate-200 pb-9">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-orange-700">
          Nomalog handbook
        </p>
        <h1 className="mt-4 text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl">
          Build a safer delivery workflow.
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">
          Get your organization connected, understand how decisions are made, and configure evidence
          with practical guides for developers and platform teams.
        </p>
        <Link
          href="/docs/quickstart"
          className="mt-6 inline-flex items-center gap-2 rounded-md bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800"
        >
          Start with the quickstart <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="grid gap-4 py-8 sm:grid-cols-2">
        {DOCS_GROUPS.map((group) => {
          const Icon = ICONS[group.label] ?? BookOpen;
          return (
            <section key={group.label} className="rounded-xl border border-slate-200 p-5">
              <Icon className="h-5 w-5 text-orange-700" />
              <h2 className="mt-4 text-base font-bold text-slate-950">{group.label}</h2>
              <ul className="mt-3 space-y-3">
                {group.docs.map((doc) => (
                  <li key={doc.slug}>
                    <Link
                      href={`/docs/${doc.slug}`}
                      className="group flex items-center justify-between gap-2 text-sm font-medium text-slate-700 hover:text-orange-800"
                    >
                      {doc.title}
                      <ArrowRight className="h-4 w-4 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-orange-700" />
                    </Link>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{doc.summary}</p>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <section className="rounded-xl bg-slate-950 p-6 text-white sm:flex sm:items-center sm:justify-between sm:gap-6">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <ShieldCheck className="h-5 w-5 text-orange-300" />
            Start with a test repository
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">
            Connect GitHub, review the setup checklist, then evaluate a pull request before rolling
            governance out across your organization.
          </p>
        </div>
        <Link
          href="/onboarding"
          prefetch={false}
          className="mt-5 inline-flex shrink-0 items-center gap-2 rounded-md bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-400 sm:mt-0"
        >
          Create workspace <ArrowRight className="h-4 w-4" />
        </Link>
      </section>
    </DocsFrame>
  );
}
