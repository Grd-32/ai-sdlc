# Customer lifecycle acceptance report

**Assessment date:** 2026-10-17  
**Release decision:** **Not commercially launch-ready**

This report distinguishes code-path and mocked-test evidence from database-backed
or live-provider evidence. A passing unit test does not establish that a customer
completed the corresponding production journey.

## Summary

The repository contains a connected public assessment, organization onboarding,
GitHub-backed assessment/report pipeline, configured plans and server-side
entitlements, Stripe webhook processing, Change Passport workflows, and customer
settings. This update adds explicit OAuth recovery, consent-gated analytics,
audited local GitHub disconnection, owner-confirmed organization deletion
requests, and cancellation-safe assessment completion.

**No complete browser journey was executed.** A runnable controlled local
acceptance command applies committed migrations to a dedicated local database
and runs database-backed API, mocked provider/webhook, and worker golden-path
tests. On 2026-10-17, the fresh disposable database accepted all 27 migrations,
including specialized review roles; all seven acceptance groups passed
(166 tests). The disposable database was dropped afterward, and the existing
`ai_sdlc` application database remains present with its existing eight
organizations, two users, and two repositories. The acceptance checks validate internal flows with controlled
identity/provider fixtures and local PostgreSQL/Redis, not live GitHub,
payment, or source-control services. The direct cross-organization
assessment-report test passes, including confirming report/provenance content
is not disclosed. This is not production or browser acceptance. The product
must not be represented as commercially launch-ready on this evidence.

## Acceptance scenarios

| Scenario                                          | Result                                            | Evidence and remaining limitation                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. New user completes a free assessment           | **Partial; not end-to-end verified**              | OAuth-to-onboarding and organization creation routes exist; assessment creation and processing have API/worker unit coverage. OAuth denial is now returned to an actionable onboarding page. No real GitHub OAuth, App installation, repository selection, or browser assessment was run.                                               |
| B. Returning user opens a prior report            | **Partial; report retrieval not exercised**       | Assessment history and report APIs are tenant-scoped in code, and the report console polls persisted status. PostgreSQL migrations are applied locally, but a persisted report retrieval was not exercised in this verification.                                                                                                        |
| C. Failed assessment recovers                     | **Partial; provider failure not exercised live**  | Retry eligibility, quota reservation, status, and error UI are implemented; retry API tests pass. No real provider failure followed by a successful retry was run.                                                                                                                                                                      |
| D. User requests another organization's report    | **Database-backed authorization check passed**    | The tenant-isolation suite requests an Org B assessment report as an Org A user against the configured local database; the route returns `404 NOT_FOUND` without report content. Broader deployed authorization validation remains outstanding.                                                                                         |
| E. User completes test-mode checkout              | **Not verified**                                  | Checkout and entitlement code has unit coverage, but no Stripe test account, Price, webhook secret, Checkout session, or test event was supplied.                                                                                                                                                                                       |
| F. Duplicate payment webhook                      | **Code-level only**                               | Billing webhook unit tests cover duplicate delivery/idempotency behavior. No Stripe-signed event was delivered by Stripe or its CLI in this environment.                                                                                                                                                                                |
| G. Expired subscription uses a restricted feature | **Partial; database/live lifecycle not verified** | Server-side entitlement code and billing tests cover non-active access behavior. No database-backed expiry transition was run.                                                                                                                                                                                                          |
| H. User cancels a subscription                    | **Not verified with Stripe**                      | Billing cancellation/portal paths are present, but no provider cancellation, period-end transition, payment-failure recovery, or reactivation was exercised.                                                                                                                                                                            |
| I. User disconnects a repository integration      | **Partial; provider revocation remains manual**   | A tenant-scoped admin API disables the installation and repositories, cancels affected queued/running assessments, writes an audit event, and blocks disabled/inactive installations in webhook/analysis paths. Mocked route tests pass. The user must also remove the GitHub App in GitHub; that provider-side revocation was not run. |
| J. User initiates data deletion                   | **Code path implemented; external cleanup is operator-confirmed** | The owner submits an audited request after confirming the organization slug. A separate allowlisted operator must reconfirm the slug and attest/document completed billing and provider-side cleanup; active, trialing, or past-due local subscriptions block erasure. Approval transactionally cascades organization-owned data and retains a detached request tombstone/audit row. Provider cleanup is not called automatically; backup expiry, legal holds, and production deletion verification remain operational gates. |

## Tests executed

| Command / validation                                                                                        | Result                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cross-tenant API authorization (`tenant-isolation.test.ts`, local PostgreSQL)                               | **1 file, 13 tests passed.** Includes a direct Org A request for an Org B assessment report; receives `404 NOT_FOUND` with no report data.                                                                                                                                                               |
| Worker suite                                                                                                | **10 files, 39 tests passed.** Includes the executable controlled golden path and assessment processing tests; external GitHub calls are mocked.                                                                                                                                                         |
| Source-control adapters                                                                                     | **7 files, 50 tests passed.** Includes Bitbucket and Azure DevOps commit metadata normalization, pagination, malformed responses, permission denials, and network failures.                                                                                                                              |
| Controlled acceptance runner (`pnpm test:acceptance:controlled`)                                            | **Passed on a fresh disposable local database.** All 27 migrations applied; provider fixtures (25 tests), webhook behaviors (23), queue/disconnect behavior (35), DB API/tenant tests (38), database policy controls (10), specialized review roles (6), and worker assessment/golden path (29) passed; 166 total. |
| Workspace lint, typecheck, and production build                                                             | **Passed** after specialized review roles and component-risk expiry handling were added.                                                                                                                                                                                                                 |
| Prisma migration state                                                                                      | **Passed on a newly created disposable database:** all 27 repository migrations applied successfully. The disposable database was dropped; the existing application database remained present. The dedicated Redis DB was empty before the run and cleared afterward. Backup/restore was not tested.    |
| Browser customer journey and live identity-provider, GitHub App, Stripe, Bitbucket, and Azure DevOps checks | **Not run / unavailable.**                                                                                                                                                                                                                                                                               |

## Verified working flows in code-level tests

- Assessment creation validates the explicit data-processing acknowledgement,
  repository scope, idempotency, and a ten-repository maximum before queueing.
- Assessment retries reserve quota; the worker preserves cancellation rather
  than converting a cancelled run to a completed report.
- Assessment report and history paths use the organization scope.
- A database-backed tenant-isolation test directly verifies that an Org A user
  cannot retrieve an Org B assessment report; the API responds with not-found.
- The worker golden-path suite runs a controlled webhook-to-analysis-to-policy
  and passport flow with provider network calls mocked. This is integration
  coverage of the internal worker flow, not browser or live-provider acceptance.
- `pnpm test:acceptance:controlled` provides a repeatable local gate that
  migrates an explicitly named local test/acceptance database, runs local
  PostgreSQL and an isolated Redis logical database with mocked
  provider/identity tests, and rejects remote database/Redis hosts or database
  names that are not marked for testing. The 2026-10-17 run dropped its
  disposable PostgreSQL database after completion.
- Per-organization notification preferences support a master email switch and
  category-level switches; worker tests confirm opt-outs keep notifications
  in-app while skipping email.
- A scheduled worker issues a deduplicated overdue-finding notice to the
  assignee and security administrators; focused worker/scheduler tests pass.
- Billing route and webhook unit tests cover configured plans, event
  idempotency, signature failure paths, and subscription synchronization logic.
- OAuth denial and invalid/expired state lead to onboarding recovery messages,
  rather than raw JSON callback errors.
- The local disconnect API scopes installation lookup to the authorized
  organization, disables associated repositories, and cancels affected
  in-flight assessment records.
- An organization owner can request deletion only after confirming the exact
  organization slug; the status explicitly says the request is pending and
  data is not immediately removed.
- Analytics is disabled unless a Google Analytics 4 ID is configured and a
  user accepts. Events use a code allowlist, omit custom properties, and send
  only normalized page categories rather than page query strings.

## External setup and remaining blockers

1. The local development database is migrated and schema-synced. For each
   external environment, configure a dedicated PostgreSQL database, take and
   verify a backup, apply migrations, generate the client, and run the
   tenant-isolation and database tests against an isolated dataset. For an
   existing database without migration history, verify both its schema and
   migration-chain diff before baselining; mark a repair migration applied
   only when the represented objects are already present. Never use
   `migrate reset` on customer data.
2. Configure a test GitHub App, OAuth callback, webhook URL/secret, repository
   permissions, and disposable organization/repository. Exercise login,
   authorization denial, assessment, installation deletion, and customer
   initiated disconnection.
3. Configure Stripe test-mode products/Price, keys, webhook secret, and
   endpoint. Verify Checkout, duplicate/out-of-order events, invoice/payment
   failure, cancellation, and server-side entitlement transitions using signed
   test events.
4. Add browser-based journey tests for all A–J scenarios, including
   cross-organization report access, inaccessible repositories, failure/retry,
   billing lifecycle, and disconnect/deletion request states.
5. Define and staff the deletion-request procedure: verify authority, resolve
   active subscriptions, identify records retained for audit/legal needs,
   remove eligible organization data and provider-side data, and notify the
   requester. Account-wide deletion is not currently provided.
6. Ensure the GitHub App removal instructions are operationally clear.
   Nomalog's local disconnect stops processing but does not itself revoke
   GitHub's App authorization.
7. Decide whether to configure optional analytics. If enabled, review consent,
   privacy notice, applicable legal requirements, and deployed Google Analytics
   settings. Without a configured measurement ID, no analytics script/events
   are sent.
8. Confirm customer-facing plan names, commercial terms, usage limits, support
   coverage, incident response, and production operational readiness.

## Controlled pilot release checklist

- [ ] Apply migrations and verify backup/restore against the pilot database.
- [ ] Complete database-backed authorization, tenant-isolation, quota,
      concurrency, retry, and cancellation tests.
- [ ] Complete the browser acceptance journey in a staging environment.
- [ ] Run GitHub OAuth/App installation and revocation against a disposable
      GitHub organization.
- [ ] Run Stripe's complete test-mode lifecycle and confirm entitlements are
      granted only after verified provider events.
- [ ] Confirm unavailable scanners/features are surfaced as limitations, not
      successful checks.
- [ ] Publish the operational deletion and integration-disconnection
      procedures and assign an owner for pending deletion requests.
- [ ] Verify monitoring, alert routing, worker recovery, privacy settings,
      support contact, and incident escalation with the pilot operators.
- [ ] Review the implementation matrix and this report after all external
      evidence is captured.

Until the above blockers are resolved, the appropriate release classification
is **controlled development/staging validation**, not commercial launch.
