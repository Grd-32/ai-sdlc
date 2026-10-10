# Privacy and Data Lifecycle

## Organization Export

Organization administrators can request a JSON export with `GET /api/organizations/:organizationId/export`. The API verifies organization membership and the `ADMIN` minimum role before querying data. The response contains the organization and its organization-owned records, with member user fields explicitly selected. A successful export is recorded as `ORGANIZATION_DATA_EXPORTED` in the audit log and returned as an attachment.

Credential-like fields are recursively omitted from the export, including secret, token, password, credential, authorization, private-key, API-key, and stored credential-hash fields. The raw API key and SCIM bearer token are never exportable; their hashes are also omitted. Audit-chain `integrityHash` and `previousHash` values are preserved because they are required to verify the integrity chain and are not authentication credentials. Run `pnpm audit:verify <organization-export.json>` to check an exported organization's complete audit chain. Treat exported webhook payloads, audit metadata, finding descriptions, member email addresses, and repository identifiers as sensitive customer data. Store and transfer exports using the organization's approved controls.

The export is currently synchronous and loads the organization's records into memory. It is suitable only for modest data volumes; background export jobs, encrypted object storage, expiring download links, export size limits, and user-level data exports are not implemented.

## Current Retention Behavior

The worker schedules cleanup once every 24 hours using a durable BullMQ job scheduler. Global retention ages can be configured with `SESSION_RETENTION_DAYS` and `WEBHOOK_RETENTION_DAYS`; defaults are 30 and 90 days. Values must be positive integers. An organization `ADMIN` can override webhook retention through `PATCH /api/organizations/:organizationId/settings/retention` with `{ "webhookRetentionDays": 45 }`; use `null` to restore the global default. Overrides are limited to integer values from 1 to 3650. Session retention remains global because sessions are user-scoped. The cleanup behavior is:

| Data                    | Current helper behavior                                                                                             | Limitation                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Sessions                | Deletes expired sessions and revoked sessions older than `SESSION_RETENTION_DAYS`                                   | Global setting; the session cutoff also applies to expired sessions                                                                |
| GitHub webhook events   | Deletes `COMPLETED`, terminal `FAILED`, or `DLQ` rows using the organization's override or `WEBHOOK_RETENTION_DAYS` | `RECEIVED`, `PROCESSING`, and `RETRYING` rows do not expire through this helper; audit events are not deleted by retention cleanup |
| Other organization data | No retention or archival cleanup                                                                                    | Per-organization override applies only to finalized webhook rows; no legal hold or deletion workflow                               |

Webhook event rows include provider payload JSON and may contain personal or repository metadata. BullMQ retryable failures are marked `RETRYING` (without a terminal `processedAt`) until the final attempt, preventing retention from removing the delivery while retries remain. Operational and audit records may also contain customer identifiers. Audit records are intentionally not part of automated retention cleanup; any future audit-retention policy must account for integrity-chain and legal obligations.

## Deletion, Residency, and Environment Scoping

There is no authenticated customer data deletion request or export lifecycle workflow yet. The database schema has an organization environment configuration model, but API-level environment scoping and policy enforcement are not implemented. Data residency controls, legal holds, deletion verification, and a customer-facing privacy notice are also outstanding. Session retention remains global and code-configured through environment variables; organization-specific webhook retention is supported only for finalized webhook-event rows.

Do not treat deleting a local Docker volume, deleting an organization directly in the database, or invoking a cleanup helper as a supported customer deletion procedure. Production deletion must wait for an approved workflow that accounts for cascading data, audit retention obligations, backups, and verification of backup expiry.
