"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CreditCard, ExternalLink, RefreshCw } from "lucide-react";
import type { CommercialPlanOffer } from "@/lib/api";
import { trackProductEvent } from "@/components/product-analytics";

interface BillingPayload {
  provider: "STRIPE" | "MANUAL" | null;
  hasStripeCustomer: boolean;
  hasStripeSubscription: boolean;
  entitlements: {
    plan: string;
    effectivePlan: string;
    status: string;
    billingAccessOnly: boolean;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    entitlements: CommercialPlanOffer["entitlements"];
    subscription: {
      cancelAtPeriodEnd: boolean;
      latestInvoiceStatus: string | null;
      agreementName: string | null;
    } | null;
  };
  usage: {
    ASSESSMENT_ATTEMPT: number;
    ASSESSMENT_COMPLETED: number;
    ANALYSIS_JOB: number;
  };
  invoices: Array<{
    id: string;
    status: string;
    amountDue: number | null;
    amountPaid: number | null;
    currency: string | null;
    hostedInvoiceUrl: string | null;
    createdAt: string;
  }>;
  canManageBilling: boolean;
  canProvisionEnterprise: boolean;
}

interface Envelope<T> {
  data: T | null;
  error: { message: string } | null;
}

export function BillingConsole({
  organizationId,
  organizationName,
  organizationRole,
}: {
  organizationId: string;
  organizationName: string;
  organizationRole: string;
}) {
  const [billing, setBilling] = useState<BillingPayload | null>(null);
  const [plans, setPlans] = useState<CommercialPlanOffer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [checkoutNotice, setCheckoutNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [agreementName, setAgreementName] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [enterpriseLimits, setEnterpriseLimits] = useState({
    maxRepositories: 100,
    assessmentsPerMonth: 100,
    analysisJobsPerMonth: 10000,
    retentionDays: 365,
    maxTeamMembers: 100,
  });
  const activationTracked = useRef(false);
  const roleCanManage = ["OWNER", "ADMIN"].includes(organizationRole.toUpperCase());

  const load = useCallback(async () => {
    setError(null);
    try {
      const [billingResponse, plansResponse] = await Promise.all([
        fetch(`/api/backend/api/organizations/${organizationId}/billing`, { cache: "no-store" }),
        fetch("/api/backend/api/billing/plans", { cache: "no-store" }),
      ]);
      const [billingEnvelope, plansEnvelope] = (await Promise.all([
        billingResponse.json(),
        plansResponse.json(),
      ])) as [Envelope<BillingPayload>, Envelope<CommercialPlanOffer[]>];
      if (!billingResponse.ok || !billingEnvelope.data) {
        setError(billingEnvelope.error?.message ?? "Unable to load organization billing.");
        return;
      }
      if (!plansResponse.ok || !plansEnvelope.data) {
        setError(plansEnvelope.error?.message ?? "Unable to load configured plans.");
        return;
      }
      setBilling(billingEnvelope.data);
      setPlans(plansEnvelope.data);
    } catch {
      setError("Billing service could not be reached. Please retry.");
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
    const checkout = new URLSearchParams(window.location.search).get("checkout");
    if (checkout === "success") {
      setCheckoutNotice(
        "Checkout returned successfully. Stripe's verified subscription event must confirm the plan before paid access is enabled.",
      );
    } else if (checkout === "cancelled") {
      setCheckoutNotice("Checkout was cancelled. No paid subscription was activated.");
    }
  }, [load]);

  useEffect(() => {
    const checkout = new URLSearchParams(window.location.search).get("checkout");
    if (
      checkout === "success" &&
      billing &&
      billing.entitlements.effectivePlan !== "FREE_ASSESSMENT" &&
      ["ACTIVE", "TRIALING"].includes(billing.entitlements.status) &&
      !activationTracked.current
    ) {
      activationTracked.current = true;
      trackProductEvent("subscription_activated");
    }
  }, [billing]);

  const submit = async (
    action: "checkout" | "portal" | "cancel" | "resume" | "enterprise",
    body?: unknown,
  ) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/backend/api/organizations/${organizationId}/billing/${action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        },
      );
      const envelope = (await response.json()) as Envelope<{ url?: string }>;
      if (!response.ok || !envelope.data) {
        setError(envelope.error?.message ?? "Billing request failed.");
        return;
      }
      if (envelope.data.url) {
        if (action === "checkout") trackProductEvent("checkout_started");
        window.location.assign(envelope.data.url);
        return;
      }
      if (action === "cancel") trackProductEvent("subscription_cancelled");
      await load();
    } catch {
      setError("Billing service could not be reached. Please retry.");
    } finally {
      setBusy(false);
    }
  };

  if (!billing || plans.length === 0) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <h1 className="text-2xl font-semibold">Billing</h1>
        {error ? (
          <p
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          >
            {error}
          </p>
        ) : (
          <p className="text-sm text-slate-500">Loading billing details…</p>
        )}
        <button type="button" onClick={() => void load()} className="button-secondary">
          <RefreshCw className="h-4 w-4" /> Retry
        </button>
      </div>
    );
  }

  const state = billing.entitlements;
  const effectivePlan = plans.find((plan) => plan.id === state.effectivePlan);
  const professional = plans.find((plan) => plan.id === "PROFESSIONAL");
  const activePaid = state.effectivePlan !== "FREE_ASSESSMENT";

  return (
    <main className="mx-auto max-w-5xl space-y-6">
      <header>
        <p className="eyebrow">Workspace administration</p>
        <h1 className="mt-2 text-2xl font-semibold">Billing and plan</h1>
        <p className="mt-1 text-sm text-slate-500">{organizationName}</p>
      </header>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {checkoutNotice && (
        <p
          role="status"
          className="rounded-md border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900"
        >
          {checkoutNotice}
        </p>
      )}
      {state.billingAccessOnly && (
        <div
          role="status"
          className="flex gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
        >
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">Paid plan access is paused.</p>
            <p className="mt-1">
              Subscription status: {state.status}. Paid continuous analysis is paused. Billing,
              account management, and data export remain available; data is not deleted.
            </p>
          </div>
        </div>
      )}
      {state.subscription?.latestInvoiceStatus === "open" ||
      state.subscription?.latestInvoiceStatus === "uncollectible" ? (
        <div
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900"
        >
          Payment requires attention. Use the billing portal to review the invoice or update the
          payment method.
        </div>
      ) : null}

      <section className="surface-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Current plan
            </p>
            <h2 className="mt-2 text-xl font-semibold">
              {effectivePlan?.name ?? "Free Assessment"}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Subscription state: {state.status}
              {state.subscription?.cancelAtPeriodEnd ? " · Cancels at period end" : ""}
            </p>
            {state.subscription?.agreementName && (
              <p className="mt-1 text-sm text-slate-600">
                Agreement: {state.subscription.agreementName}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {billing.canManageBilling && (
              <>
                {!activePaid &&
                  !billing.hasStripeSubscription &&
                  professional?.selfServeCheckout && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void submit("checkout")}
                      className="button-primary"
                    >
                      <CreditCard className="h-4 w-4" /> Subscribe to Professional
                    </button>
                  )}
                {billing.provider === "STRIPE" && billing.hasStripeCustomer && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void submit("portal")}
                    className="button-secondary"
                  >
                    <ExternalLink className="h-4 w-4" /> Billing portal
                  </button>
                )}
                {activePaid && state.subscription && (
                  <>
                    {billing.provider === "STRIPE" && (
                      <>
                        {state.subscription.cancelAtPeriodEnd ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void submit("resume")}
                            className="button-secondary"
                          >
                            Resume subscription
                          </button>
                        ) : state.plan === "PROFESSIONAL" ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void submit("cancel")}
                            className="button-secondary"
                          >
                            Cancel at period end
                          </button>
                        ) : null}
                      </>
                    )}
                  </>
                )}
              </>
            )}
            {!billing.canManageBilling && (
              <p className="text-sm text-slate-500">
                Ask an organization owner or administrator to manage billing.
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="surface-card p-6">
        <h2 className="text-lg font-semibold">Plan limits and usage</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Usage
            label="Connected repositories"
            value={`Max ${state.entitlements.maxRepositories}`}
          />
          <Usage
            label="Assessment attempts"
            value={`${billing.usage.ASSESSMENT_ATTEMPT} / ${state.entitlements.assessmentsPerMonth}`}
          />
          <Usage label="Completed assessments" value={String(billing.usage.ASSESSMENT_COMPLETED)} />
          <Usage
            label="Analysis jobs"
            value={`${billing.usage.ANALYSIS_JOB} / ${state.entitlements.analysisJobsPerMonth}`}
          />
          <Usage
            label="Continuous analysis"
            value={state.entitlements.continuousAnalysis ? "Included" : "Not included"}
          />
          <Usage
            label="Assessment report retention"
            value={`${state.entitlements.retentionDays} days`}
          />
          <Usage label="Team members" value={`Max ${state.entitlements.maxTeamMembers}`} />
        </dl>
        <p className="mt-4 text-xs leading-5 text-slate-500">
          Usage is an internal entitlement counter, not proof that a payment was collected.
          Assessment attempts, successfully completed assessments, and analysis jobs are tracked
          separately.
        </p>
        <Link
          href="/pricing"
          className="mt-4 inline-block text-sm font-medium text-orange-800 underline"
        >
          View configured plan catalogue
        </Link>
      </section>

      {billing.invoices.length > 0 && (
        <section className="surface-card p-6">
          <h2 className="text-lg font-semibold">Recent invoices</h2>
          <ul className="mt-4 divide-y divide-slate-200">
            {billing.invoices.map((invoice) => (
              <li
                key={invoice.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
              >
                <span>
                  {new Date(invoice.createdAt).toLocaleDateString()} · {invoice.status}
                  <span className="ml-2 text-slate-500">
                    Paid {formatCurrency(invoice.amountPaid, invoice.currency)} · Due{" "}
                    {formatCurrency(invoice.amountDue, invoice.currency)}
                  </span>
                </span>
                {invoice.hostedInvoiceUrl && (
                  <a
                    className="text-orange-800 underline"
                    href={invoice.hostedInvoiceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View invoice
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {billing.canProvisionEnterprise && (
        <form
          className="surface-card space-y-4 p-6"
          onSubmit={(event) => {
            event.preventDefault();
            void submit("enterprise", {
              agreementName,
              expiresAt: expiresAt ? new Date(expiresAt).toISOString() : "",
              entitlements: enterpriseLimits,
            });
          }}
        >
          <h2 className="text-lg font-semibold">Provision an enterprise agreement</h2>
          <p className="text-sm text-slate-600">
            Available only to a server-configured billing administrator. This enables the
            implemented features and limits below; it does not unlock unimplemented integrations.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Agreement name
              <input
                required
                minLength={3}
                maxLength={200}
                value={agreementName}
                onChange={(event) => setAgreementName(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="text-sm">
              Agreement expiry
              <input
                required
                type="date"
                value={expiresAt}
                onChange={(event) => setExpiresAt(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              />
            </label>
            {Object.entries(enterpriseLimits).map(([key, value]) => (
              <label key={key} className="text-sm">
                {key.replace(/([A-Z])/g, " $1")}
                <input
                  type="number"
                  min={0}
                  max={100000}
                  value={value}
                  onChange={(event) =>
                    setEnterpriseLimits((previous) => ({
                      ...previous,
                      [key]: Number(event.target.value),
                    }))
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                />
              </label>
            ))}
          </div>
          <button type="submit" disabled={busy || !roleCanManage} className="button-primary">
            Provision agreement
          </button>
        </form>
      )}
    </main>
  );
}

function Usage({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-base font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

function formatCurrency(amount: number | null, currency: string | null): string {
  if (amount === null || !currency) return "unavailable";
  const normalizedCurrency = currency.toUpperCase();
  const formatter = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: normalizedCurrency,
  });
  const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(amount / 10 ** fractionDigits);
}
