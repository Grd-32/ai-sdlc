# Nomalog

Nomalog is an enterprise software-governance platform that connects GitHub changes to organization policy, risk, security evidence, AI provenance, and accountable human review. It helps engineering and security teams govern software delivery with traceable decisions rather than relying on assumptions about how code was produced.

## What this repo contains

- `apps/api`: Hono API for dashboard and admin routes
- `apps/web`: Next.js workspace for members, changes, policies, and evidence
- `apps/worker`: BullMQ worker for background processing
- `packages/db`: Prisma schema and tenant-aware database helpers
- `packages/github`: GitHub app/webhook support and app configuration helpers
- `packages/policy`: policy evaluation engine
- `packages/risk`: deterministic risk scoring and sensitive-area classification
- `packages/security`: normalized finding and passport integrations
- `packages/provenance`: AI involvement and provenance tracking
- `docs`: operational and compliance guidance

## Current status

Nomalog is an actively developed product. The repository includes:

- tenant-scoped organizations, membership administration, role checks, and audit events
- GitHub App installation, signed webhook ingestion, and idempotent processing
- repository change analysis, deterministic risk and policy decisions, and evidence records
- per-commit human-review assignment and decision tracking with GitHub Check Run updates
- member sign-in visibility, privacy exports, retention cleanup, and operational tooling

Implementation status and the evidence still needed for production rollout are tracked in the
[Product Implementation Matrix](./docs/PRODUCT_IMPLEMENTATION_MATRIX.md). The platform is not
production-ready merely because a workflow exists in code: validate identity/provider setup,
branch protection, backups, monitoring, and recovery in the target deployment before enforcing
policies for production repositories.

## Local development

Follow the step-by-step [Local Development Setup](./docs/LOCAL_DEVELOPMENT_SETUP.md)
to configure environment variables, prepare the database, start each service,
and run the checks.

## Tenant-scoped identity lifecycle

GitHub installation IDs are globally unique: the setup callback may create a new
organization link or refresh an installation already owned by that same
organization, but it rejects attempts to link an installation owned by another
organization. SCIM `active` changes apply only to the SCIM token's organization
membership. The global `User.active` flag remains reserved for account-wide
authentication controls, so deactivating a SCIM membership blocks access to
that organization without disabling a shared user account or its membership in
another organization.

## Key operational docs

- [docs/PRODUCT_IMPLEMENTATION_MATRIX.md](./docs/PRODUCT_IMPLEMENTATION_MATRIX.md)
- [docs/LOCAL_DEVELOPMENT_SETUP.md](./docs/LOCAL_DEVELOPMENT_SETUP.md)
- [docs/ENTERPRISE_READINESS_AUDIT.md](./docs/ENTERPRISE_READINESS_AUDIT.md)
- [docs/PRIVACY_DATA_LIFECYCLE.md](./docs/PRIVACY_DATA_LIFECYCLE.md)
- [docs/OPERATIONS_RUNBOOK.md](./docs/OPERATIONS_RUNBOOK.md)
- [docs/OBSERVABILITY.md](./docs/OBSERVABILITY.md)
- [docs/DISASTER_RECOVERY.md](./docs/DISASTER_RECOVERY.md)
- [docs/LOAD_TESTING.md](./docs/LOAD_TESTING.md)
- [docs/CAPACITY_MODEL.md](./docs/CAPACITY_MODEL.md)
- [docs/FINAL_ADVERSARIAL_SECURITY_REVIEW.md](./docs/FINAL_ADVERSARIAL_SECURITY_REVIEW.md)
- [SECURITY.md](./SECURITY.md)
- [THREAT_MODEL.md](./THREAT_MODEL.md)
- [PENTEST_SCOPE.md](./PENTEST_SCOPE.md)

## Milestone progression

- Milestone J: Privacy + data residency controls
- Milestone K: Compliance readiness, security posture, and testability
- Milestone L: Performance + load testing
- Milestone M: Disaster recovery and restore readiness
- Milestone N: Executive UX, policy simulation, and admin operations
- Milestone O: Final adversarial security review and rollout gate

This repository tracks compliance and operational maturity through the milestone sequence laid out in the enterprise readiness audit.
