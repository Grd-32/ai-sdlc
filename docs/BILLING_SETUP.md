# Plans, subscriptions, and billing setup

## Commercial model

The plan catalogue is server-configured in `packages/billing/src/index.ts`.
Public pricing and authenticated billing views read the API catalogue rather
than defining their own prices or limits.

`FREE_ASSESSMENT` is free, enables the scoped assessment and data export, and
does not include continuous analysis. The initial default limits are 10 enabled
repositories, 1 assessment attempt in a rolling 30-day window, 5 active
members, and 90-day assessment-report retention.

`PROFESSIONAL` enables the implemented continuous PR analysis and policy
management workflows. Defaults are 25 repositories, 10 assessment attempts
and 1,000 analysis jobs per Stripe subscription period, 25 active members, and
90-day assessment-report retention.

`ENTERPRISE` is assigned only by a server-authorized billing operator after
agreement. The operator records an agreement name, expiry, and negotiated
limits. Enterprise integrations remain disabled because they are not
implemented and verified. Plan lapse pauses paid continuous analysis; it
does not delete customer data. Existing data export and account/billing access
remain available.

The numerical defaults are initial product configuration, not approved prices
or an industry benchmark. Set per-environment variables before deployment to
change plan labels, descriptions, limits, and public price presentation. The
Free Assessment attempt quota is rolling 30 days. Paid usage windows follow
the Stripe subscription billing period. Usage records are internal counters,
not payment records or provider-cost estimates.

`retentionDays` applies to persisted assessment reports (not every class of
security evidence or organization data). Other data lifecycle policies remain
as separately documented by the application.

## Stripe test-mode setup

Stripe account credentials and catalog configuration were not present in the
repository environment when this implementation was made. Billing is therefore
unconfigured until an operator supplies test-mode values:

1. Create a Stripe account or use the organization's existing account. Keep
   Stripe in **test mode** during development.
2. Create a recurring Professional product and a recurring Price in Stripe.
   Do not invent or infer the amount; obtain commercial approval first.
3. Configure the API server environment:

   ```dotenv
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   STRIPE_PRICE_PROFESSIONAL=price_...
   PLAN_PROFESSIONAL_DISPLAY_PRICE=Set the approved displayed price
   PLAN_PROFESSIONAL_INTERVAL=month
   ```

   Keep all Stripe secrets server-only. Do not add them to `NEXT_PUBLIC_*`
   variables, source control, browser code, or build arguments.

4. Configure the Stripe customer portal to allow customers to update payment
   methods, view invoices, cancel at period end, and (if supported by the
   organization's approved Price catalogue) switch subscription prices.
5. Register `https://<api-host>/api/webhooks/stripe` in Stripe. Subscribe to:
   `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `invoice.paid`, `invoice.payment_failed`, and `invoice.finalized`.
6. Put the endpoint signing secret in `STRIPE_WEBHOOK_SECRET`. The API verifies
   the exact raw body with Stripe's signature verifier before persisting or
   processing an event. Failed events receive a non-2xx response for provider
   retry; event IDs are deduplicated and stale processing claims can be retried.
   Subscription notifications retrieve Stripe's current record, and an older
   subscription cannot replace a newer subscription already synchronized for
   the same customer.
7. Apply the database migration and deploy the API and worker with the same
   server-side commercial limit configuration:

   ```sh
   pnpm --filter @ai-sdlc/db migrate
   pnpm --filter @ai-sdlc/db generate
   ```

8. Use Stripe test cards and Stripe's webhook forwarding/test-event tools.
   Verify Checkout completion, cancellation, duplicate delivery, out-of-order
   subscription events, invoice failure, cancellation/resume, and billing
   portal actions. Confirm the organization remains on Free until a verified
   webhook synchronizes an active Stripe subscription. A browser success URL
   alone never enables paid access.

For local forwarding, use Stripe CLI in test mode and forward to the local API
port's `/api/webhooks/stripe` endpoint. Do not use live credentials for these
tests.

## Subscription lifecycle

- The API creates a Stripe customer bound to the authorized organization and
  starts Stripe-hosted subscription Checkout.
- Only a verified Stripe event followed by a server-side subscription
  retrieval can synchronize plan and status. The return URL is informational.
- Active and trialing subscriptions receive configured paid entitlements.
  Pending cancellation remains active through the paid period; after expiry,
  the effective plan falls back to Free.
- `past_due`, `unpaid`, `incomplete`, canceled, and expired agreements do not
  receive paid continuous-analysis or policy-management entitlements.
  The billing portal remains available to recover payment for an existing
  Stripe customer; data export and account access also remain available.
- Cancellation is scheduled at period end. Administrators can resume before
  that date. Changes to prices and additional self-service plan changes are
  controlled through Stripe's customer portal configuration; the application
  does not accept a client-supplied price ID.
- Invoice status is stored with the hosted invoice URL. Payment-card details
  are never stored in this application.
- Enterprise agreements can be provisioned only by a user ID listed in
  `BILLING_ADMIN_USER_IDS`, who must also be an organization owner or admin.
  Provisioning requires a future expiry date and records agreed limits in the
  organization subscription. Expired agreements automatically lose paid
  entitlements; customer data is retained under its own retention policy.

## Server-side enforcement and usage

The billing package is the authoritative catalogue/entitlement source. The API
enforces repository limits during GitHub installation synchronization and
webhook ingestion, assessment limits inside a serializable transaction, and
member limits on direct and SCIM provisioning. The worker checks continuous
analysis entitlement and reserves an idempotent analysis-usage record before
processing. Quota reservations use a per-organization database advisory lock
and serializable transactions to prevent concurrent jobs from exceeding a
limit.

Usage records distinguish assessment attempts, completed assessments, and
analysis jobs. An eligible user-requested assessment retry reserves another
attempt before it is queued. A unique organization/idempotency key makes
retries safe.
These records do not represent collected revenue, refunds, or Stripe's
provider-side usage.

## Operational checks and limitations

- No live Stripe API credentials or Stripe account were available during
  implementation. Checkout, portal, and provider event delivery must be
  verified in Stripe test mode before enabling self-service paid billing.
- Professional checkout remains unavailable unless a recurring Stripe Price
  ID is configured. The Free and Enterprise routes remain usable without
  Stripe.
- `BILLING_ADMIN_USER_IDS` must contain the trusted operator's internal user
  ID; granting that user ID is a deployment decision.
- Existing enabled repositories above a newly lowered limit are not deleted or
  silently disabled. New repositories and assessments are blocked until the
  organization is within the configured limit or upgrades.
- Current application analysis is the existing pull-request workflow. The plan
  catalogue does not claim scanner providers or enterprise integrations that
  are not configured and verified.
