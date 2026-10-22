# Enterprise notifications: current state and design

This document describes the repository's notification behavior and the
implementation requirements for configurable escalation and enterprise
channels. It does not claim live provider delivery or webhook reconciliation.

## Verified current behavior

- Notifications are stored in the application and delivered asynchronously
  through the worker. Email delivery uses Resend when configured.
- Email status is tracked as `PENDING`, `SENT`, `SKIPPED`, or `FAILED`, with
  per-attempt status, timestamps, latency, and a sanitized error code.
- Organization administrators can inspect a bounded recent delivery history
  and retry failed deliveries.
- `SENT` means the provider accepted the send request; it does not prove
  mailbox delivery. Provider message IDs and bounce/delivery event
  reconciliation are not currently used to establish final delivery state.
- Finding SLA escalation runs daily and sends one deduplicated overdue
  notification to the finding assignee (when present) and organization
  `OWNER`, `ADMIN`, and `SECURITY` roles.
- The current escalation is a single overdue stage, not a configurable
  multi-stage policy. Slack and Microsoft Teams delivery are not implemented.

## Proposed escalation policy

Add a validated organization policy with ordered stages. Each stage should
contain:

- A stable stage identifier and elapsed duration relative to the finding due
  time (for example, at due time and after a configured delay).
- Eligible severity/status filters.
- Recipient selectors limited to supported roles and/or the current assignee.
- Enabled delivery channels.

Evaluate each finding-stage pair idempotently and persist a delivery record
with a unique key. Reassignments, due-date changes, status changes, and policy
edits must not cause duplicate notifications. A resolved, accepted, or
false-positive finding must stop future escalation. A changed due date should
recalculate future stages without deleting the audit history.

The administrator UI must show the effective stage schedule and recipients,
validate ordering and bounds, and provide a preview before saving. Changes
must be audited. Keep the current once-daily scheduler initially; alert on
scheduler lag and make the maximum detection delay explicit.

## Mandated channels and provider delivery

Distinguish user preferences from organization requirements. An organization
may mandate a channel for selected event categories/severities; users may
disable optional channels but cannot disable a mandated channel. The UI must
identify which delivery is organization-required and explain the configured
destination without exposing credentials.

Implement delivery through provider adapters with separate attempt records.
Use first-party Slack and Microsoft Teams application integrations or
administrator-configured encrypted credentials. Do not accept arbitrary
organization-supplied webhook URLs without SSRF controls, egress restrictions,
destination validation, and secret-safe error handling.

For final delivery reconciliation:

1. Persist the provider message/event ID and send attempt before acknowledging
   success.
2. Verify inbound provider signatures/tokens and reject replayed event IDs.
3. Map accepted, delivered, bounced/failed, and unknown provider events to
   explicit states; never map a missing callback to delivered.
4. Make event processing idempotent and tenant-scope the channel lookup.
5. Retry transient failures with bounded backoff; do not retry permanent
   bounces to the same address.
6. Provide an administrator view of channel health, last successful event,
   delivery latency, and actionable failures.

## Decisions and external validation

- Select SLA stage defaults and maximum supported stages.
- Decide which event types and severities require organization-mandated
  channels.
- Choose Slack/Teams installation model, tenant consent, credential storage,
  and administrator ownership.
- Configure and verify provider webhook endpoints and delivery signatures in
  real provider test tenants.
- Define retention for notification content, delivery attempts, and provider
  event payloads. Do not retain full provider payloads if a minimal event ID,
  type, and timestamp are sufficient.

Until implemented and exercised with provider test tenants, administrators
must treat `SENT` as provider acceptance only and must not rely on the current
single-stage email escalation as a contractual SLA control.
