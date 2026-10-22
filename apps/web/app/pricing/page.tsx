import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { PublicShell } from "@/components/public-shell";
import { ProductEventLink, type ProductAnalyticsEvent } from "@/components/product-analytics";
import { offerContactHref, offerCopy } from "@/lib/public-site";
import { getCommercialPlans } from "@/lib/api";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Start with Nomalog's free assessment or ask about Professional and Enterprise plans.",
  alternates: { canonical: "/pricing" },
};
export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const plans = await getCommercialPlans();
  const free = plans.find((plan) => plan.id === "FREE_ASSESSMENT");
  const professional = plans.find((plan) => plan.id === "PROFESSIONAL");
  const enterprise = plans.find((plan) => plan.id === "ENTERPRISE");
  return (
    <PublicShell>
      <main className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-24">
        <p className="eyebrow">Offers</p>
        <h1 className="page-title">Start with evidence. Discuss the right next step.</h1>
        <p className="page-lede">
          Begin with the free assessment. Professional and Enterprise teams can get in touch to
          discuss a plan that fits their rollout.
        </p>
        {plans.length === 0 ? (
          <p
            role="status"
            className="mt-10 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
          >
            Plan information is temporarily unavailable. Please contact sales for current commercial
            terms.
          </p>
        ) : (
          <>
            <div className="mt-10 grid gap-4 lg:grid-cols-3">
              {free && (
                <Offer
                  title={free.name}
                  badge="Start here"
                  copy={free.description}
                  price={free.displayPrice}
                  points={[
                    `Up to ${free.entitlements.maxRepositories} connected repositories`,
                    `${free.entitlements.assessmentsPerMonth} assessment(s) per billing period`,
                    "No continuous monitoring",
                  ]}
                  cta="Start assessment"
                  href="/assessment"
                  event="assessment_cta_clicked"
                />
              )}
              {professional && (
                <Offer
                  title={professional.name}
                  badge="For teams"
                  copy={professional.description || offerCopy.professional}
                  price={professional.displayPrice}
                  points={[
                    `Up to ${professional.entitlements.maxRepositories} repositories`,
                    `${professional.entitlements.analysisJobsPerMonth} analysis jobs per billing period`,
                    `${professional.entitlements.maxTeamMembers} team members`,
                    `Assessment report retention: ${professional.entitlements.retentionDays} days`,
                  ]}
                  cta={
                    professional.selfServeCheckout
                      ? "Sign in to subscribe"
                      : "Enquire about Professional"
                  }
                  href={
                    professional.selfServeCheckout
                      ? "/api/auth/github/login?redirectTo=/dashboard/billing"
                      : offerContactHref("professional")
                  }
                  event={professional.selfServeCheckout ? "signup_started" : undefined}
                />
              )}
              {enterprise && (
                <Offer
                  title={enterprise.name}
                  badge="For organizations"
                  copy={enterprise.description || offerCopy.enterprise}
                  price={enterprise.displayPrice}
                  points={[
                    "Agreement-provisioned plan and usage limits",
                    "Configured continuous analysis and policy entitlements",
                    "Data export and agreement-defined report retention",
                    "Unimplemented integrations remain unavailable",
                  ]}
                  cta="Contact sales"
                  href={offerContactHref("enterprise")}
                />
              )}
            </div>
            <p className="mt-6 text-sm leading-6 text-slate-500">
              Prices and plan names come from deployment configuration. Professional checkout is
              available only after a Stripe Price has been configured.
            </p>
          </>
        )}
      </main>
    </PublicShell>
  );
}

function Offer({
  title,
  badge,
  copy,
  points,
  cta,
  href,
  price,
  event,
}: {
  title: string;
  badge: string;
  copy: string;
  points: string[];
  cta: string;
  href: string;
  price: string;
  event?: ProductAnalyticsEvent;
}) {
  return (
    <section className="surface-card flex flex-col p-6 sm:p-7">
      <p className="text-xs font-semibold uppercase tracking-wider text-orange-800">{badge}</p>
      <h2 className="mt-3 text-2xl font-semibold">{title}</h2>
      <p className="mt-2 text-xl font-semibold text-slate-950">{price}</p>
      <p className="mt-3 min-h-20 text-sm leading-6 text-slate-600">{copy}</p>
      <ul className="mt-5 flex-1 space-y-3 text-sm text-slate-700">
        {points.map((point) => (
          <li key={point} className="flex gap-2">
            <Check className="h-4 w-4 shrink-0 text-emerald-700" />
            {point}
          </li>
        ))}
      </ul>
      {event ? (
        <ProductEventLink
          href={href}
          event={event}
          className="button-primary mt-7 w-full justify-center"
        >
          {cta} <ArrowRight className="h-4 w-4" />
        </ProductEventLink>
      ) : (
        <Link href={href} className="button-primary mt-7 w-full justify-center">
          {cta} <ArrowRight className="h-4 w-4" />
        </Link>
      )}
    </section>
  );
}
