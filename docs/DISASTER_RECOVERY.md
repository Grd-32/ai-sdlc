# Disaster Recovery and Backup/Restore Plan

## Scope

This repository includes operational guidance and a basic backup automation entry point for the local Compose environment. It does not replace a production DR plan, cloud-provider backup policy, or customer-specific compliance requirement.

## Current status

The project currently supports:

- daily retention cleanup for expired sessions and finalized webhook events
- operational runbook guidance for triage and service restarts
- a reproducible local environment via Docker Compose

The project does not yet define a production backup schedule, retention for database snapshots, or a formal failover/restore test for customer workloads. The backup automation below is intentionally conservative and is intended as a baseline for staging or local recovery exercises.

## Recovery objectives

The default operational assumptions are:

- RPO: the repository does not yet guarantee a production RPO target; for local or staging recovery, the acceptable window is whatever the operator documents before the restoration task.
- RTO: the repository does not yet define a production TTR/TCO objective; restore timing must be validated by the owning deployment team.
- backup retention: production environments must define a retention period and encryption-at-rest requirement outside this repo.

## Backup strategy

### Database backup

Use the repository helper:

```bash
pnpm db:backup
```

This script:

- reads `DATABASE_URL`
- creates a timestamped PostgreSQL dump in `./backups/`
- names the output using the current UTC timestamp and database slug
- writes a plaintext `.sql` dump suitable for restore validation or team review

Production environments should replace this with encrypted object storage snapshots or a managed database snapshot policy.

### Artifact backup

In production, back up the following in addition to the database:

- environment configuration and secret-manager references
- deployment manifests and Helm/Kubernetes configuration
- built application artifacts and release metadata
- worker config and retry state referenced by the queue

## Restore strategy

Use the repository helper:

```bash
pnpm db:restore -- ./backups/ai_sdlc-2026-10-09T12-00-00Z.sql
```

The script validates that a backup path was supplied and then restores the dump into the target database connection. The operator must confirm the target database is the correct environment before executing the restore.

The following checks are required before and after restore:

1. confirm the target environment and current backup timeline
2. verify the backup file is authentic and uncorrupted
3. validate the DB connection string and required privileges
4. confirm application readiness after restore
5. re-check tenant and import integrity for organization data

## Restore test process

A DR exercise should include:

- a backup created from a known-good environment
- a restore into a disposable staging database
- verification of schema and data integrity
- application startup checks and route smoke tests
- audit validation for key administrative actions

Do not treat a local Docker volume deletion or ad-hoc `DROP DATABASE` as an acceptable recovery exercise.

## Operational restrictions

- Do not remove or recreate data volumes without a documented restore plan.
- Do not restore directly into a live production database without a change window and stakeholder approval.
- Do not store production secrets or customer data in the repo or plaintext local backup artifacts outside approved storage controls.
- Treat backup verification as mandatory before calling the restore successful.

## Future production hardening

The following items remain open before a regulated production rollout:

- managed automated database snapshots with retention policy
- encrypted backup storage with access controls
- restore drill automation and audit evidence
- RTO/RPO commitment and ownership matrix
- production failover and customer communication procedures
