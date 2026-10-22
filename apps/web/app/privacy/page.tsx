import type { Metadata } from "next";
import Link from "next/link";
import { PublicShell } from "@/components/public-shell";
import { AnalyticsPreferences } from "@/components/product-analytics";

export const metadata: Metadata = {
  title: "Privacy notice",
  description: "How Nomalog handles information used to provide the service.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <PublicShell>
      <main className="mx-auto max-w-3xl px-5 py-16 sm:px-8 sm:py-24">
        <p className="eyebrow">Your information</p>
        <h1 className="page-title">Privacy notice</h1>
        <p className="page-lede">
          This notice explains the information Nomalog uses to operate the service, provide
          repository governance features, and support your organization.
        </p>
        <div className="prose-copy mt-8 space-y-7">
          <section>
            <h2>Information the service handles</h2>
            <p>
              Depending on use, Nomalog processes GitHub account details, organization membership
              and email, repository identifiers, pull-request metadata, changed-file information,
              policy and review decisions, evidence, audit metadata, webhook records, and session
              data.
            </p>
          </section>
          <section>
            <h2>How information is used</h2>
            <p>
              Nomalog uses account and organization information to authenticate users, manage
              workspace access, process connected GitHub events, display change analysis and
              evidence, and maintain operational and audit records.
            </p>
          </section>
          <section>
            <h2>Connected services</h2>
            <p>
              GitHub provides authentication, repository installation, webhook events, pull-request
              context, and optional Code Scanning results. If an administrator enables Azure AI
              review, eligible diffs are sent to the configured Azure resource. Those providers have
              their own terms and privacy notices.
            </p>
          </section>
          <section>
            <h2>Retention and deletion</h2>
            <p>
              Session records have a 30-day default retention and finalized webhook records a 90-day
              default retention. Other organization records and audit events are not deleted by that
              cleanup. An organization owner can submit a data-deletion request from workspace
              settings. Requests require operator verification and are not immediate; active
              subscriptions must be resolved before fulfillment. Account-wide deletion,
              data-residency controls, and legal-hold features are not currently provided. Consult
              the <Link href="/docs/data-lifecycle">data lifecycle guide</Link>.
            </p>
          </section>
          <section>
            <h2>Cookies and analytics</h2>
            <p>
              The application uses cookies for authentication and organization selection. If a
              Google Analytics 4 measurement ID is configured, the analytics script is not loaded
              unless you explicitly allow optional analytics. Only allowlisted event names and
              coarse page categories are sent; URL query strings, repository details, account
              identifiers, source code, findings, and secrets are not sent as event data. Rejecting
              analytics is the default, and you can reopen the choice below. Google may still
              process standard technical request data when analytics is enabled under its own terms.
            </p>
            <div className="mt-3">
              <AnalyticsPreferences />
            </div>
          </section>
          <section>
            <h2>Your choices and questions</h2>
            <p>
              Organization administrators control which repositories they connect and can manage
              workspace members. For questions about the service or information it handles, use the{" "}
              <Link href="/contact">contact page</Link>.
            </p>
          </section>
        </div>
      </main>
    </PublicShell>
  );
}
