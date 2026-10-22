import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CircleAlert } from "lucide-react";
import { PublicShell } from "@/components/public-shell";

export const metadata: Metadata = {
  title: "Security and privacy",
  description:
    "Understand current Nomalog integration permissions, data processing, retention, and security limitations.",
  alternates: { canonical: "/security" },
};

export default function SecurityPage() {
  return (
    <PublicShell>
      <main className="mx-auto max-w-4xl px-5 py-16 sm:px-8 sm:py-24">
        <p className="eyebrow">Trust &amp; operations</p>
        <h1 className="page-title">Security and privacy, described as implemented.</h1>
        <p className="page-lede">
          Review this summary alongside the integration permissions and the operating controls of
          the deployment you use. It is not a certification or a substitute for your security
          review.
        </p>
        <div className="mt-10 space-y-4">
          <section className="surface-card p-6">
            <h2 className="text-lg font-semibold">Repository access</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Nomalog integrates through a GitHub App. An organization administrator chooses the
              repositories to which it is installed. The app processes subscribed installation and
              pull-request events. GitHub permissions required for optional Code Scanning evidence
              are documented in the{" "}
              <Link href="/docs/github" className="font-semibold text-orange-800 underline">
                GitHub guide
              </Link>
              .
            </p>
          </section>
          <section className="surface-card p-6">
            <h2 className="text-lg font-semibold">Source code and provider processing</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              The assessment is based on pull-request metadata and supported change signals; it is
              not a full repository scan. When optional Azure AI review is enabled, eligible diffs
              are transmitted to the configured Azure resource. Review provider, region, retention,
              and contractual terms before enabling it.
            </p>
          </section>
          <section className="surface-card p-6">
            <h2 className="text-lg font-semibold">Stored information and retention</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              The application may persist repository identifiers, pull-request details, risk and
              policy decisions, evidence, audit metadata, organization member details, webhook
              records, and sessions. Session retention defaults to 30 days and finalized webhook
              retention to 90 days; other organization records and audit events are not removed by
              that cleanup. See the{" "}
              <Link href="/docs/data-lifecycle" className="font-semibold text-orange-800 underline">
                data lifecycle guide
              </Link>
              .
            </p>
          </section>
          <section className="surface-card p-6">
            <h2 className="text-lg font-semibold">Application controls</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              The implementation includes organization-scoped authorization, GitHub webhook
              signature verification, audit event integrity checks, and credential-like value
              redaction in organization exports. The deployment operator remains responsible for
              infrastructure access, TLS, secrets, backups, monitoring, and incident response.
            </p>
          </section>
        </div>
        <aside className="mt-6 rounded-md border border-amber-200 bg-amber-50 p-5">
          <h2 className="flex items-center gap-2 font-semibold text-amber-950">
            <CircleAlert className="h-4 w-4" />
            Known limitations
          </h2>
          <p className="mt-2 text-sm leading-6 text-amber-950">
            Customer deletion workflow, data-residency controls, legal holds, externally audited
            certifications, and production backup/restore evidence are not established by this
            application. Do not treat these as available guarantees.
          </p>
        </aside>
        <Link
          href="/docs/data-lifecycle"
          className="mt-7 inline-flex items-center gap-2 text-sm font-semibold text-orange-800"
        >
          Read data lifecycle details <ArrowRight className="h-4 w-4" />
        </Link>
      </main>
    </PublicShell>
  );
}
