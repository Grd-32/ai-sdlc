# Final Adversarial Security Review

## Scope

This document defines the final security review gate for the AI-SDLC control plane before broader enterprise rollout. It is intentionally adversarial: the goal is to test the product as an attacker, a malicious insider, or a compromised tenant would see it.

## Review objectives

1. Confirm that tenant boundaries are enforced in every read and write path.
2. Validate that API and webhook endpoints resist replay, forgery, and misuse.
3. Check that secrets, session cookies, and admin-only controls are protected from leakage.
4. Verify that retention and export flows minimize exposure of customer data.
5. Confirm that incident response, recovery, and observability controls are not just documented but actually usable.

## Attack scenarios to run

### 1. Cross-tenant access

- Sign in as a user in Organization A.
- Attempt to read or mutate Organization B resources via URL tampering or manipulated IDs.
- Verify that all routes reject requests with the correct organization-scoped role and membership checks.
- Confirm that even parameter tampering cannot permit a downgrade or bypass.

### 2. Webhook forgery and replay

- Submit unsigned or invalid payloads to `/api/webhooks/github`.
- Verify that invalid signatures are rejected with 401/403 and no side effect occurs.
- Replay a previously valid event with a duplicate delivery ID.
- Ensure idempotency or deduplication logic prevents repeated processing.
- Reuse a delivery ID with a different event type or payload and verify the request is rejected with 409.

The ingestion path now atomically claims each provider/delivery ID before performing side effects. Exact replays return the original event and deterministic job ID without repeating processing; a delivery ID paired with a different event or payload is rejected. Failed ingestion claims can be reclaimed for a GitHub retry. Focused unit coverage for these behaviors is in `apps/api/src/webhooks.test.ts`. This code-level coverage does not replace validation of signed requests against the running API and database.

### 3. Session abuse and cookie exposure

- Attempt to forge or reuse stale session cookies.
- Verify that sessions are server-side and revocable.
- Confirm that cookie attributes are restrictive and the app does not trust client-side session ownership as a privilege source.

Session validation rejects unknown, revoked, expired, and inactive-user sessions; expiration is exclusive at the `expiresAt` boundary. Session tokens are opaque URL-safe random values, while only SHA-256 token hashes are stored. Login cookies are `HttpOnly`, `SameSite=Lax`, path-scoped, and `Secure` in production. Unit coverage for these conditions is in `packages/db/src/sessions.test.ts`; API coverage for missing and forged cookies is in `apps/api/src/tenant-isolation.test.ts`. Run the database-backed API tests with the test database configured to validate the cookie/auth flow end-to-end.

### 4. Secret and token leakage

- Review logs and API responses for raw secret material, private keys, or token values.
- Ensure that API key and SCIM token hashes, rather than raw secrets, are retained.
- Check all exports and admin endpoints for redaction of secret-like properties.

The organization export and identity-provider create/update responses recursively remove secret-, token-, credential-, key-, and hash-named fields. Secret-like identity-provider metadata is also removed before persistence and audit recording. The SCIM bearer-token endpoint returns its plaintext token only at creation; stored SCIM/API-key hashes are excluded from exports. Coverage is in `apps/api/src/security/redaction.test.ts` and the database-backed export/auth route cases in `apps/api/src/tenant-isolation.test.ts`.

### 5. Retention and privacy control bypass

- Attempt to regenerate or export data outside the expected organization boundary.
- Validate that retention cleanup only deletes allowed expired data.
- Confirm that purge operations cannot silently remove in-flight webhook or audit data outside the approved retention model.

Cleanup filters webhook rows to terminal statuses only; retryable deliveries are marked `RETRYING` until BullMQ exhausts attempts, so they remain outside retention deletion. Automated cleanup has no audit-event delete path. Per-organization webhook retention overrides are validated in the cleanup helper as well as at the settings API. Focused DB tests assert the terminal-status filter, absence of audit deletion, and rejection of invalid override ages; worker tests cover retrying-versus-terminal webhook failures.

### 6. Service-account and admin abuse

- Try to escalate a viewer or auditor role to admin-level access via API manipulation.
- Review API keys, service accounts, and role checks for privilege drift.
- Ensure admin-only operations require the correct role, not just a valid login state.

Member administration now limits role grants and target-member changes to the acting administrator's own role level; only an `OWNER` can grant or manage `OWNER` membership, including through the existing-member upsert path. API-key verification also rejects keys tied to inactive service accounts. Database-backed route tests cover viewer denial, admin-to-owner escalation, and attempts to demote an owner through upsert; DB tests cover service-account deactivation invalidating its key.

GitHub installation callbacks reject IDs already linked to another organization, including a race-safe check before updating an existing installation. SCIM activation changes update only the organization membership; inactive memberships are excluded from organization access checks, while the account-wide user state and other organizations' memberships remain unchanged. Database-backed lifecycle tests cover cross-organization installation reassignment and SCIM POST/PATCH/DELETE deactivation for users shared across organizations.

## Required evidence

Before sign-off, the review should produce evidence for:

- role and membership tests for at least one cross-tenant scenario
- webhook verification tests for valid, invalid, and replayed payloads
- session and auth negative tests
- retention and export redaction validation
- audit event verification and tamper review for admin actions
- operational logs captured during the review

Audit events include a canonicalized SHA-256 integrity hash linked to the previous event. Writes are serialized per organization using a transaction-scoped PostgreSQL advisory lock so concurrent admin actions cannot create competing chain heads. `verifyAuditEventChain` validates event hashes, parent links, missing hashes, and forks without relying on timestamp ordering. Organization exports preserve the integrity-chain hashes while still omitting credential hashes. Verify an exported chain with `pnpm audit:verify <organization-export.json>`; exit code 0 means valid, 2 means the chain is invalid, and 1 means the export could not be read or parsed. Unit tests cover valid chains, payload tampering, broken links, missing integrity hashes, and forks; a database-backed test covers concurrent chain writes. A settings test also checks the integrity hash of the retention-change audit event.

### Repeatable code-level evidence

Run `pnpm security:review` to build runtime workspace dependencies and execute the database-independent webhook replay, signature, session, authorization, redaction, retention, audit-integrity tests, and API/DB typechecks. The command reports each check's result and does not mark live operational or response-team gates as complete. To run database-backed webhook/API, tenant lifecycle, audit-write, and service-account integration tests, configure `SECURITY_REVIEW_DATABASE_URL` and `SECURITY_REVIEW_REDIS_URL` in the local environment with dedicated, disposable test services, then run `pnpm security:review --with-database`. The runner passes these URLs to tests as `DATABASE_URL` and `REDIS_URL` and will not fall back to the application's ordinary service URLs. Confirm these services contain no data that must be preserved. A configured URL alone is not evidence that services are reachable or credentials work; preserve command output and resolve any failure before sign-off.

### Local execution record — 2026-10-09

- `pnpm security:review`: passed 40 database-independent tests and API/DB typechecks.
- Earlier `pnpm security:review --with-database` attempt: code checks passed, but database-backed suites could not initialize because the workspace-configured PostgreSQL credentials for `ai_sdlc` were rejected. No database-backed assertions completed. The runner now requires explicit isolated test-service URLs to prevent accidentally targeting ordinary application services.
- Runtime operations evidence was unavailable: Compose reported only Redis running; the API health endpoint on `localhost:3001` refused connections. No live alert, log, or restore evidence or response-team review was produced in this environment.
- Result: automated code-level checks pass, but final sign-off is **blocked** pending successful DB-backed integration, operational evidence, response-team review, and assigned residual-risk owners.

## Review gate

The final gate is passed only if all of the following are true:

- no cross-tenant access is possible without a valid organization membership
- all webhook ingestion is rejected without a valid signature
- secrets and tokens are never serialized in plain text to API responses or logs, except a documented one-time credential issuance response
- retention and export flows are scoped to the authenticated organization
- review evidence is attached to the issue or ticket for future audit

## Residual risk

This repository has strong fundamentals but remains a milestone platform rather than a fully hardened production deployment. Final adversarial review should be treated as a gating exercise for enterprise rollout, not a claim of production readiness.

## Sign-off checklist

- [ ] Tenant isolation confirmed across all route families
- [ ] GitHub webhook verification validated with invalid signatures and replays
- [ ] Session misuse and stale-cookie rejection tested
- [ ] Secret redaction validated for export and admin outputs
- [ ] Retention cleanup validated against real policy rules
- [ ] Audit events captured for security-sensitive operations
- [ ] Operational runbook and DR controls reviewed by the response team
- [ ] Risk acceptance or remediation tracked for any open issue
