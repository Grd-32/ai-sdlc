# Data lifecycle controls: current state and design

This document records the data-lifecycle gaps identified in the product
milestones and a safe implementation design. It is not evidence that any
external backup, provider-side deletion, legal hold, or regional deployment
has been configured.

## Verified repository behavior

- Organization export is an authenticated, administrator-only API operation.
  It loads the organization and many related collections in one Prisma query,
  then returns a JSON response. This is not suitable for unbounded tenant
  histories because the application materializes the export in memory.
- Organization deletion has a request/approval workflow. The application
  cannot independently prove that data held by GitHub or another provider was
  removed; provider cleanup confirmation remains an operator responsibility.
- Organization-scoped records use database relations and cascades, but
  account-wide deletion across multiple organizations is not implemented.
- The repository does not define a legal-hold model, tenant data-residency
  routing, or backup-artifact expiry verification.

## Proposed controls

### Account-wide deletion

Add a durable deletion request with an explicit state machine:

`REQUESTED -> CONFIRMATION_REQUIRED -> APPROVED -> PURGING -> COMPLETE`

`BLOCKED` and `FAILED` must retain a reason and retry history. A deletion
request must identify the authenticated account and verify control of the
account before approval. Revoke sessions and credentials immediately after
approval. Enumerate every organization membership and integration before
purging; do not silently delete an organization owned by other people.

Before implementation, define how to handle the last owner of an organization,
shared audit records, billing records, and user-authored content. Preserve
only records with a documented legal or operational basis, and pseudonymize
the account identity where that is sufficient. Provider revocation/deletion
must be represented per provider as `PENDING`, `CONFIRMED`, `UNAVAILABLE`, or
`FAILED`, with operator, timestamp, and evidence reference. Do not mark the
request `COMPLETE` while required provider work is unresolved.

### Legal holds

Use an explicit, auditable hold record rather than a boolean on an account.
Each hold should have a scope (organization, account, or data category), case
reference, issuer, reason, effective time, optional expiry/release, and
authorized approver. Restrict access to hold metadata and audit every read or
change. The deletion and retention workers must check active holds before
purging covered data and record a visible blocked state.

A hold must not silently disable all deletion or preserve unrelated data.
Release must be an explicit audited action. A hold on live application data
does not by itself preserve expiring provider backups or external provider
records; those systems need separate documented procedures.

### Backup expiry and restoration evidence

Maintain an inventory for every backup artifact: storage location/region,
creation time, encryption-key identifier, checksum, retention deadline,
deletion state, and last verification result. A scheduled verifier should
confirm that expected artifacts exist, are encrypted, and are not past their
retention deadline. Expired artifacts must be deleted and the deletion
recorded; a missing object or unverifiable key must be an explicit failure.

Test restores into an isolated environment on a recurring schedule. Record
restore point, duration, integrity checks, schema/migration state, and
follow-up actions. A successful backup job is not proof that the backup can
be restored. Keep backup retention and deletion semantics consistent with
active legal holds and the customer contract.

### Data residency

Treat residency as a tenant placement invariant, not a display preference.
An organization must be assigned a home region before its first persistent
data is written. Database, object storage, encryption keys, logs, backups,
exports, and background processing must honor that region. Cross-region
support access, telemetry, email, identity, source-control metadata, and
disaster recovery must be disclosed separately.

The current repository does not demonstrate region-aware persistence or
regional routing. Do not claim a residency guarantee until deployment
infrastructure and every processor/provider path are verified. Region moves
need an explicit migration procedure with a consistency check and rollback.

### Scalable exports

Replace the synchronous, whole-organization include with an asynchronous
export job. The job should:

1. Capture the tenant and requester's authorization at creation and re-check
   membership before download.
2. Read data in bounded, deterministic pages and write a versioned stream
   (JSON Lines or a documented archive) to encrypted, region-matched object
   storage.
3. Record progress, row counts, checksum, failure state, and expiry.
4. Return a short-lived download URL only to an authorized requester; never
   expose the object key or make the object public.
5. Delete the artifact automatically at its expiry and record the deletion.
6. Audit creation, download, failure, and expiry without copying exported
   content into logs.

The first implementation should retain the current export format version or
provide an explicit versioned format migration. Redact credential hashes,
ciphertexts, tokens, and other secrets before writing the stream.

## Decisions required before implementation

1. Account deletion grace period and whether approval is self-service,
   administrator-mediated, or both.
2. Ownership transfer and treatment of shared audit/history records when an
   account leaves an organization.
3. Legal-hold authority, permitted scopes, default expiry, and who may release
   a hold.
4. Contractual retention periods for primary data, backups, exports, and
   provider-side records.
5. Required residency regions and which service metadata may leave a region.
6. Export format, maximum retention, and whether export jobs are a paid-plan
   feature.

Until those decisions and the required infrastructure are available, the
existing deletion request and synchronous export must not be represented as
complete account-wide lifecycle controls.
