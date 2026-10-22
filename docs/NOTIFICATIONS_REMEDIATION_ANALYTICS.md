# Notifications, remediation, and governance analytics

## Notifications and email

Review and finding assignments, high/critical findings detected during
continuous pull-request analysis, policy BLOCK decisions, assessment completion
or terminal failure, and approaching/expired risk acceptances create
user-scoped, organization-scoped inbox entries for eligible members.
Assessment-mode analyses do not emit operational finding or policy alerts.
Notifications are deduplicated by recipient and originating workflow
identifier. Assessment notifications are sent to active OWNER, ADMIN, and
SECURITY members and do not include report contents or provider errors.

Email delivery is optional and uses the Resend API from the worker. Configure
these server-only environment variables on the worker:

- `RESEND_API_KEY`
- `EMAIL_FROM` (a sender verified by the Resend account)
- `APP_URL` (the public Nomalog base URL used to create action links)

For local development, setting these variables does not verify the sender or
make email links publicly reachable. Resend only accepts a sender address
permitted by the account: use its provided test sender only where the account
allows it, or verify a domain you control and use an address at that domain.
An address at a domain you have not purchased or verified (for example,
`info@nomalog.com`) will not work as a sender merely because it is configured
in `.env`. With `APP_URL=http://localhost:3000`, links in test emails are only
usable from the local development environment.

If `RESEND_API_KEY` is absent, notifications are kept in-app and email is
recorded as skipped. Provider failures are retried by BullMQ with bounded
exponential backoff. Each worker attempt records its state, elapsed time, and a
redacted error code. Organization owners and administrators can inspect recent
delivery states and attempts on the Notifications page; notification content,
recipient addresses, API keys, and raw provider error bodies are not shown in
that operations view. `SENT` means the provider returned a successful response,
not that the recipient's mail server delivered or the user read the message.
The recipient inbox is tenant- and user-scoped, supports cursor pagination,
unread counts, category/severity filters, and read-state updates.
Administrators can manually retry failed attempts; retry actions are audited
and a new attempt sequence is persisted. Provider delivery webhooks,
bounce/complaint reconciliation, and delivery-latency alerting are not
implemented. Do not add provider credentials to a `NEXT_PUBLIC_` variable.
Member invitations use an explicit account-invitation notification. Delivery is
allowed only while the referenced invitation is pending, unexpired, and still
matches the recipient and organization; accepting or revoking it prevents
subsequent queued invitation emails. Acceptance requires an authenticated
account whose email matches the invite.

Email preferences are scoped to each user in an organization and include a
master switch plus independent SECURITY, ASSESSMENTS, GOVERNANCE, INTEGRATIONS,
and ACCOUNT switches. A disabled preference suppresses email only; in-app
notifications remain available. Unclassified event types follow the master
switch until assigned a category. Daily remediation SLA processing sends a
deduplicated overdue notification to the assignee and security administrators
once per finding due date. Organization-mandated channels, Slack/Teams routing,
and configurable multi-stage escalation are not implemented.

## Finding remediation

Organization members with the ENGINEER permission or higher can transition
findings through `OPEN`, `TRIAGED`, `IN_PROGRESS`, `RESOLVED`, `ACCEPTED`, and
`FALSE_POSITIVE`. Updates are tenant-scoped and produce an activity record and
audit event. Assignees must be active members; optional due dates feed the
overdue backlog view and trigger a daily notification when overdue.

`ACCEPTED` requires a rationale and future expiration time. The record is saved
in `RiskAcceptance`; reopening an accepted finding revokes the active acceptance.
A daily worker warns eligible members once when an acceptance is within seven
days of expiry, then expires due acceptances, reopens an associated finding
only if it is still in `ACCEPTED`, records an activity and audit event, and
notifies security administrators/owners. Notification completion is tracked
so retries do not repeat completed transitions. A manually resolved finding is
marked `USER_REPORTED`; the current workflow does not claim verification from a
code change alone. For GitHub Code Scanning findings with a stable alert number,
an engineer can request a provider check. The API reads that exact alert through
the linked GitHub App installation and marks it `PROVIDER_VERIFIED` only when
GitHub returns the same alert number in the `fixed` state. A linked evidence
record, activity, and audit event preserve the provider observation. Other
provider finding types are unsupported; a missing, dismissed, inaccessible, or
non-fixed alert is not treated as resolution evidence. This API path has not
been verified against a live GitHub installation.
Expiry for component risks is recorded and notified. When the final active
acceptance for a component expires, the worker moves the component from
`ACCEPTED` to `REVIEW`; a remaining unexpired acceptance prevents the status
change. Component-specific remediation SLA scheduling is not implemented.

## Governance analytics

The analytics page provides 7-, 30-, and 90-day UTC daily trends for new pull
requests, completed reviews, and resolved findings, along with the current open
finding backlog by severity, overdue count, review approval rate, and average
duration for findings marked `RESOLVED` (accepted or false-positive findings
are not counted as remediated). Active and expired risk acceptances are also
reported. Period metrics use event timestamps; review outcomes
completed before `Review.completedAt` was introduced are absent from review
trends and approval-rate calculations. Validate these definitions with
customer reporting requirements before using them for contractual or
regulatory attestations.

Repository assessment coverage counts repositories included in completed
assessments, including completed-with-limitations, in the selected period
divided by enabled repositories. Current-head analysis coverage is pull
requests whose current head SHA matches the last analyzed SHA divided by pull
requests created in the period. Unknown provenance is counted among those
analyzed pull requests; `UNKNOWN` means available evidence did not confirm AI
use, not that AI was not used. Active and revoked source-control connections
are counts, not a provider health guarantee. No formal compliance claim is
implied by these metrics.

Users with organization viewer access can download these persisted metrics as a
CSV report from the analytics page. The export uses the same organization
authorization and period validation as the dashboard; it contains aggregate
metrics and daily counts, not source code or finding descriptions.
The report also includes policy-decision action counts, evidence record statuses,
notification email provider statuses, and Change Passport availability among
pull requests created in the selected period. A policy `BLOCK` decision is not
proof of provider-side merge enforcement; evidence counts are records rather
than distinct changes or scan pass rates; email `SENT` records provider
acceptance only.

## Change Passport integrity and export

Each new Change Passport analysis writes a schema-versioned SHA-256 revision
linked to its previous hash. PostgreSQL triggers reject ordinary row updates,
deletes, and truncation; organization/pull-request cascades remain possible.
Authorized organization viewers can export a JSON package containing the
passport, its revisions, and the persisted evidence snapshot (change
identifiers, commits, policy decisions, reviews, evidence references, risk
summary, provenance summary, changed files, and finding references). A
separately included `unverifiedLiveChange` relation is provided for convenience;
it is not compared with the recorded snapshot or covered by the hash chain.
Export integrity status is verified against retained revisions, and the export
action is audited.

Passports created before this revision history was introduced report
`NO_REVISION_HISTORY` until their next analysis creates a revision. The hash
chain is tamper-evident against ordinary database-row modification; it is not
a digital signature or protection against a database owner who can bypass or
remove triggers. Signing keys, external checkpoints, and independent
verification outside the database are not implemented.

Apply the committed Prisma migrations before enabling these features:

```sh
pnpm --filter @ai-sdlc/db generate
pnpm --filter @ai-sdlc/db exec prisma migrate deploy
```

The milestone workflow-gap migration adds the warning timestamp and
`SecurityFinding.resolutionVerification`. The notification preference migration
adds independent email switches for supported inbox categories. Existing
resolved findings default to `NOT_VERIFIED`; newly manually resolved findings
are marked `USER_REPORTED`. `VERIFIED` is reserved for future evidence-backed
verification and cannot be set through the manual status endpoint.
