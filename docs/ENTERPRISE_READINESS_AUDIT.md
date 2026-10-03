# Enterprise Production Readiness Audit

**Repository:** AI-SDLC Control Plane  
**Audit date:** 2026-09-19  
**Scope:** Phases 0–15 implementation vs. Enterprise Production Hardening specification  
**Method:** Direct inspection of source, schema, migrations, tests, CI, Docker, and configuration — not assumptions.

---

## Executive Summary

The AI-SDLC Control Plane is a **functional MVP/beta** with a coherent modular-monolith architecture (Hono API + Next.js web + BullMQ workers + PostgreSQL + Redis). The golden path works end-to-end: GitHub webhook → PR persistence → analysis → risk → policy → evidence → Change Passport → GitHub Check Run.

It is **not yet enterprise production-ready**. Core security product logic is present, but enterprise identity, operational resilience, scalability controls, compliance architecture, and most hardening controls from the enterprise specification are missing or only partially implemented.

| Category | Assessment |
|----------|------------|
| Core product pipeline | **Strong MVP** — working, tested golden path |
| Tenant isolation (HTTP API) | **Good foundation** — middleware + integration tests |
| Enterprise identity (SSO/SCIM) | **Missing** |
| API security hardening | **Largely missing** |
| Webhook reliability | **Partial** — dedup only |
| Observability / SRE | **Minimal** |
| Compliance / audit maturity | **Early** |
| Documentation / runbooks | **Missing** (no `docs/` prior to this audit) |

**Estimated readiness:** suitable for controlled beta / pilot deployments with trusted tenants; **not** suitable for regulated enterprise production without the milestones below.

---

## Repository Architecture (As Built)

```
pnpm monorepo
├── apps/api          Hono HTTP API (webhooks, auth, dashboard REST)
├── apps/web          Next.js 15 dashboard (SSR, cookie-forwarding to API)
├── apps/worker       BullMQ consumer (PR analysis pipeline)
└── packages/
    ├── db            Prisma + PostgreSQL schema + tenant access helpers
    ├── github        GitHub App config, webhook verify, REST, Check Runs
    ├── provenance    AI involvement inference from PR metadata
    ├── risk          Deterministic risk-v1 + sensitive-area classification
    ├── policy        Deterministic policy engine (static + DB rules)
    └── security      Provider abstraction + mock integrations + passport derivation
```

**Infrastructure:** `docker-compose.yml` (Postgres 16, Redis 7, api, worker, web). CI via `.github/workflows/ci.yml`.

**Target alignment:** Matches the spec's preferred **modular monolith + scalable workers** pattern. No premature microservice split.

---

## Subsystem Audit

Legend:

| Status | Meaning |
|--------|---------|
| **COMPLETE** | Implemented and reasonably production-usable for its scope |
| **PARTIAL** | Exists but incomplete vs. enterprise spec |
| **MISSING** | Not implemented |
| **INSECURE** | Present but creates security risk |
| **SCALABILITY RISK** | Will break or degrade at enterprise scale |
| **RELIABILITY RISK** | May lose data or fail silently under failure modes |
| **ARCHITECTURAL RISK** | Design debt that blocks enterprise goals |

Each item includes a **Priority:** P0 (critical), P1 (enterprise required), P2 (important), P3 (future).

---

### 1. Product Foundation & Monorepo

| Item | Status | Evidence | Priority |
|------|--------|----------|----------|
| pnpm workspace | COMPLETE | `pnpm-workspace.yaml`, 9 packages | — |
| TypeScript strict toolchain | COMPLETE | Root + per-package `tsconfig`, `pnpm typecheck` | — |
| Docker multi-stage builds | PARTIAL | API/worker/web Dockerfiles; API/worker run as **root** (web uses `nextjs` user) | P2 |
| Environment configuration | PARTIAL | `.env.example`; no startup validation schema | P1 |
| Semantic versioning | PARTIAL | `0.1.0` in package.json; no release engineering | P2 |

---

### 2. Database (Prisma / PostgreSQL)

| Item | Status | Evidence | Priority |
|------|--------|----------|----------|
| Tenant-aware domain model | COMPLETE | `Organization`, `OrganizationMember`, org FK on all major entities (`schema.prisma`) | — |
| Foreign keys & cascades | COMPLETE | Cascade deletes on org-owned records | — |
| Unique constraints | COMPLETE | e.g. `[provider, deliveryId]` on webhooks, `[organizationId, slug]` | — |
| Indexes for common queries | PARTIAL | Indexes on `organizationId`, `pullRequestId`, etc.; no composite pagination indexes for scale | P2 |
| Migrations | COMPLETE | 6 migrations under `packages/db/prisma/migrations/` | — |
| Connection pooling | MISSING | Default Prisma client; no PgBouncer/RDS proxy config | P1 |
| Query tenant scoping audit | PARTIAL | HTTP routes use `c.get("organizationId")`; worker jobs trust job payload IDs without cross-check | P0 |
| Unbounded queries | SCALABILITY RISK | List endpoints use `take: limit` (50–500) but no cursor pagination | P1 |
| N+1 patterns | PARTIAL | Dashboard PR list uses nested selects (acceptable at MVP scale) | P2 |
| Partitioning / archival | MISSING | No partition strategy for `AuditEvent`, `GitHubWebhookEvent`, etc. | P2 |
| Check constraints | MISSING | e.g. `risk score 0–100`, enum enforcement relies on app layer | P3 |
| `SELECT *` avoidance | COMPLETE | Routes use explicit `select` / `include` | — |
| `webhookSecret` on `GitHubInstallation` | INSECURE | Plaintext-capable column in schema; not used in code paths inspected but schema allows secret storage | P1 |

**Worker tenant isolation gap (P0):** `processPullRequestAnalyze` loads `pullRequest` by `pullRequestId` only — it does **not** verify `pullRequest.organizationId === job.data.organizationId`. A tampered queue job could cross tenant boundaries.

---

### 3. Authentication & Sessions

| Item | Status | Evidence | Priority |
|------|--------|----------|----------|
| GitHub OAuth (user sign-in) | COMPLETE | `apps/api/src/auth/github-oauth.ts` | — |
| Signed httpOnly session cookie | COMPLETE | HMAC-SHA256 in `session.ts`, 7-day TTL | — |
| OAuth state + redirect sanitization | COMPLETE | CSRF-style state cookie; open-redirect blocked | — |
| Email/password auth | MISSING | GitHub-only | P1 |
| OIDC / SAML / Enterprise SSO | MISSING | No IdP abstraction | P0 |
| SSO enforcement / domain verification | MISSING | — | P1 |
| Session revocation | MISSING | Documented MVP limitation in `session.ts`; logout clears cookie only | P1 |
| MFA compatibility | MISSING | — | P2 |
| Session timeout policies | PARTIAL | Fixed 7-day TTL; not org-configurable | P2 |
| `SESSION_SECRET` in `.env.example` | INSECURE | Example contains dev default `ai_sdlc_dev_secret` | P1 |

---

### 4. Authorization & RBAC

| Item | Status | Evidence | Priority |
|------|--------|----------|----------|
| Role-based access (HTTP) | COMPLETE | `requireOrganizationRole()` + `ensureOrganizationAccess()` | — |
| Role set | PARTIAL | `OWNER, ADMIN, SECURITY, ENGINEER, VIEWER, AUDITOR` — missing `SECURITY_ADMIN`, `SECURITY_ANALYST`, `REVIEWER` from enterprise spec | P2 |
| Centralized `authorize(user, resource, action)` | PARTIAL | Role middleware exists; no resource-aware ABAC | P1 |
| Never trust client `organizationId` | COMPLETE | Verified membership before `c.set("organizationId")` | — |
| Cross-tenant isolation tests | COMPLETE | `apps/api/src/tenant-isolation.test.ts` (7 cases) | — |
| RBAC on worker/queue paths | MISSING | No authorization on internal job processing | P0 |
| Privileged operation controls | MISSING | No step-up auth, reason capture, or four-eyes | P1 |
| API keys / service accounts | MISSING | Audit types reference `API_KEY_*` but no model or routes | P1 |
| Permission scopes | MISSING | — | P1 |

---

### 5. Tenancy Model

| Item | Status | Evidence | Priority |
|------|--------|----------|----------|
| Organization | COMPLETE | Core entity with slug | — |
| Users & memberships | COMPLETE | `OrganizationMember` with role | — |
| Repositories | COMPLETE | Org-scoped, GitHub provider | — |
| Policies | COMPLETE | Org-scoped with rules | — |
| Teams / Business Units | MISSING | — | P2 |
| Workspace / Environment (prod/staging/dev) | MISSING | No environment dimension on policies | P1 |
| Organization creation API | MISSING | Orgs created only via DB/tests; onboarding blocked | P1 |
| Data residency / region | MISSING | — | P2 |
| Per-org quotas | MISSING | — | P1 |

---

### 6. API Layer (Hono)

| Item | Status | Evidence | Priority |
|------|--------|----------|----------|
| REST dashboard API | COMPLETE | Organizations, PRs, repos, policies, evidence, agents, settings | — |
| Policy CRUD | COMPLETE | `routes/policy-management.ts` (ADMIN+) | — |
| Structured error envelope | COMPLETE | `{ data, error: { code, message } }` | — |
| API versioning (`/api/v1`) | MISSING | Routes at `/api/...` without version prefix | P1 |
| Request schema validation (Zod/etc.) | MISSING | Manual typeof checks in policy routes only | P1 |
| Rate limiting | MISSING | No IP/user/org/endpoint limits | P0 |
| Request size limits | MISSING | — | P1 |
| Idempotency keys | MISSING | Webhook job dedup only; no HTTP idempotency | P1 |
| Pagination | PARTIAL | Offset-style `limit` query param; no cursors | P1 |
| Timeouts | MISSING | — | P2 |
| OpenAPI documentation | MISSING | — | P2 |
| `/health/queue-test` | INSECURE | Unauthenticated endpoint enqueues jobs (`app.ts`) | P1 |
| Health endpoints | PARTIAL | `/health` (liveness-ish), `/health/ready` (DB+Redis); spec wants `/health/live` + `/health/ready` | P2 |
| CORS | COMPLETE | Restricted to `APP_URL`, credentials enabled | — |
| CSRF protection | PARTIAL | SameSite=Lax cookies; no CSRF tokens on mutating routes | P1 |

**Route inventory (authenticated unless noted):**

| Route | Auth | Min Role |
|-------|------|----------|
| `GET /api/organizations` | Yes | any member |
| `GET /api/organizations/:id/overview` | Yes | VIEWER |
| `GET /api/organizations/:id/pull-requests` | Yes | VIEWER |
| `GET /api/organizations/:id/pull-requests/:prId` | Yes | VIEWER |
| `GET /api/organizations/:id/repositories` | Yes | VIEWER |
| `GET /api/organizations/:id/policies` | Yes | VIEWER |
| `POST/PATCH/DELETE .../policies*` | Yes | ADMIN |
| `GET /api/organizations/:id/agents` | Yes | VIEWER |
| `GET /api/organizations/:id/installations` | Yes | ADMIN |
| `GET /api/organizations/:id/audit-events` | Yes | AUDITOR |
| `POST /api/webhooks/github` | Signature | — |
| `POST /health/queue-test` | **None** | — |

---

### 7. GitHub Integration

| Item | Status | Evidence | Priority |
|------|--------|----------|----------|
| Webhook signature verification | COMPLETE | HMAC-SHA256, timing-safe compare (`@ai-sdlc/github`) | — |
| Webhook deduplication | COMPLETE | Unique `[provider, deliveryId]` upsert | — |
| Installation linking | COMPLETE | Setup URL callback with membership verification | — |
| Installation deletion handling | COMPLETE | `handleInstallationDeleted` deactivates install + repos | — |
| PR event ingestion | COMPLETE | Upsert repo/PR/commit/AI activity | — |
| Check Run publishing | COMPLETE | Idempotent via `githubCheckRunId` + `lastAnalyzedSha` | — |
| Private key handling | COMPLETE | Supports base64 env var | — |
| Multi-SCM (GitLab, Bitbucket, ADO) | MISSING | GitHub-only; no `SourceControlProvider` interface | P2 |
| Webhook retry / reconciliation | RELIABILITY RISK | `GitHubWebhookEvent.status` stays `RECEIVED`; `processedAt` never set | P0 |
| Webhook dead-letter / attempt tracking | MISSING | No `WebhookProcessingAttempt` model | P1 |

---

### 8. Queue & Workers (BullMQ / Redis)

| Item | Status | Evidence | Priority |
|------|--------|----------|----------|
| Single queue (`github`) | COMPLETE | `QUEUE_NAMES.GITHUB` | — |
| Job retries + exponential backoff | COMPLETE | 3 attempts, 1s backoff in `queue.ts` | — |
| Webhook job deduplication | COMPLETE | Deterministic `jobId` from event+delivery | — |
| PR analysis idempotency | COMPLETE | SHA-based skip in `analyze.ts` | — |
| Horizontal worker scaling | PARTIAL | Stateless workers; no distributed lock beyond BullMQ | P2 |
| Separate queues (webhook/analysis/security/etc.) | MISSING | All job types share one queue | P1 |
| Dead-letter queues | MISSING | `removeOnFail: { count: 5000 }` only | P1 |
| Job timeouts | MISSING | — | P1 |
| Stalled job detection | PARTIAL | BullMQ default; not explicitly configured | P2 |
| Priority queues | MISSING | — | P2 |
| Per-org concurrency / fairness | MISSING | Fixed `concurrency: 5` | P1 |
| Graceful shutdown | PARTIAL | SIGTERM closes worker; does not wait for in-flight jobs to finish | P1 |
| Worker webhook processing | PARTIAL | `processGitHubWebhookEvent` only logs — no status update | P1 |

**Defined but unused job types:** `REPOSITORY_SYNC`, `COMMIT_SYNC`, `SECURITY_FINDINGS_SYNC`, `PASSPORT_REBUILD`.

---

### 9. Analysis Pipeline

| Item | Status | Evidence | Priority |
|------|--------|----------|----------|
| End-to-end PR analysis | COMPLETE | `processPullRequestAnalyze` in worker | — |
| File fetch + classification | COMPLETE | GitHub API + `@ai-sdlc/risk` | — |
| AI provenance inference | COMPLETE | `@ai-sdlc/provenance` at webhook ingest | — |
| Risk evaluation | COMPLETE | `risk-v1` deterministic engine | — |
| Policy evaluation | COMPLETE | Static baseline + org DB rules | — |
| Security evidence collection | PARTIAL | **Mock providers only** (CodeQL, Semgrep, Snyk, Sonar) | P1 |
| Change Passport derivation | COMPLETE | `deriveChangePassport` + DB persist | — |
| GitHub Check Run | COMPLETE | Published with policy/risk summary | — |
| Explicit pipeline stages | MISSING | Monolithic function; no per-stage status/timing | P2 |
| Analysis versioning record | PARTIAL | `modelVersion: risk-v1` on assessments; no unified analysis run record | P2 |
| Reproducibility on model change | RELIABILITY RISK | Passports **updated in place**; historical truth can change | P1 |
| Ephemeral source processing | COMPLETE | Fetches file metadata/paths only; no source retention | — |

---

### 10. Risk Engine

| Item | Status | Evidence | Priority |
|------|--------|----------|----------|
| Deterministic scoring | COMPLETE | `packages/risk/src/index.ts` | — |
| Sensitive area classification | COMPLETE | 17 areas, regex-based | — |
| Explainable factors | COMPLETE | Factors array + explanation string | — |
| Model versioning | COMPLETE | `RISK_MODEL_VERSION = "risk-v1"` | — |
| Risk trending / analytics | MISSING | Raw assessments stored; no aggregation API | P2 |
| Property-based tests | MISSING | Unit tests only | P3 |

---

### 11. Policy Engine

| Item | Status | Evidence | Priority |
|------|--------|----------|----------|
| ALLOW / REVIEW / BLOCK | COMPLETE | Precedence: BLOCK > REVIEW > ALLOW | — |
| Static security floor rules | COMPLETE | Payments, auth, infra, secrets, high-risk | — |
| Org-defined DB policies | COMPLETE | Phase 14; layered on static rules | — |
| Policy CRUD + audit | COMPLETE | API + `POLICY_*` audit events | — |
| Policy immutability / versioning | MISSING | Policies updated in place; `version` field unused for immutability | P1 |
| DRY_RUN / ENFORCING / DISABLED modes | MISSING | `enabled` boolean only | P1 |
| Policy simulator | MISSING | — | P2 |
| Policy conflict detection UI | MISSING | — | P2 |
| Decision replay | MISSING | — | P2 |
| OPA/Rego readiness | MISSING | Fixed condition shape | P3 |

---

### 12. Security Integrations

| Item | Status | Evidence | Priority |
|------|--------|----------|----------|
| Provider abstraction | COMPLETE | `SecurityProvider` interface in `@ai-sdlc/security` | — |
| Normalized findings | COMPLETE | `normalizeSecurityFinding`, categories, severities | — |
| Real provider integrations | MISSING | All providers return mock/stub data | P1 |
| Provider health tracking | MISSING | — | P2 |
| Circuit breakers / timeouts | MISSING | — | P1 |
| Supply chain (SBOM, SCA, IaC) | MISSING | Types exist; no ingestion | P2 |
| Finding lifecycle | PARTIAL | `status: OPEN` default; no workflow states | P2 |
| Risk acceptance | MISSING | No `RiskAcceptance` model | P2 |

---

### 13. Change Passport & Evidence

| Item | Status | Evidence | Priority |
|------|--------|----------|----------|
| Passport generation | COMPLETE | JSON payload stored in `ChangePassport` | — |
| Passport immutability | MISSING | Existing passport **updated** on re-analysis | P1 |
| Schema versioning | MISSING | No `passportSchemaVersion` | P2 |
| Cryptographic integrity (hashes) | MISSING | — | P2 |
| Evidence chain | PARTIAL | Evidence rows linked to PR; no hash/provenance chain | P2 |
| SLSA / in-toto alignment | MISSING | Architecture allows future linkage only | P3 |

---

### 14. AI Governance

| Item | Status | Evidence | Priority |
|------|--------|----------|----------|
| AI activity tracking | COMPLETE | `AIActivity` model | — |
| Provenance confidence levels | PARTIAL | `involvement`, `confidence`, `source` enums; not full observed/declared/inferred model | P2 |
| Agent inventory analytics | COMPLETE | `/agents` aggregation endpoint + dashboard page | — |
| AI agent registry (approved/blocked) | MISSING | No `AIProvider`/`AIAgent`/`AIModel` entities | P1 |
| Model governance policies | MISSING | — | P2 |
| AI-specific platform security | MISSING | No prompt-injection defenses (platform doesn't use LLM yet) | P2 |

---

### 15. Audit System

| Item | Status | Evidence | Priority |
|------|--------|----------|----------|
| Append-only audit writes | COMPLETE | `recordAuditEvent` — create only | — |
| Event types | PARTIAL | 13 types; missing many enterprise events | P2 |
| Enterprise audit fields | MISSING | No IP, userAgent, requestId, correlationId, before/after | P1 |
| Audit immutability enforcement | PARTIAL | App-layer only; DB allows UPDATE/DELETE | P1 |
| Tamper evidence / hash chain | MISSING | — | P2 |
| Audit export (CSV/JSON/NDJSON) | MISSING | — | P1 |
| Searchable audit | PARTIAL | List with limit; no filters/search | P2 |
| SIEM streaming | MISSING | — | P2 |

---

### 16. Web Application (Next.js)

| Item | Status | Evidence | Priority |
|------|--------|----------|----------|
| Dashboard pages | COMPLETE | Overview, Changes, Agents, Repositories, Policies, Evidence, Settings | — |
| Auth gate | COMPLETE | Layout redirects to GitHub login | — |
| Org switcher | COMPLETE | Cookie-based selected org | — |
| Policy management UI | PARTIAL | Policies page + Next.js route handlers proxy to API | — |
| Enterprise admin sections | MISSING | No SSO, SCIM, API keys, retention, billing UI | P2 |
| Executive / compliance views | MISSING | Basic overview metrics only | P2 |
| Frontend performance | PARTIAL | SSR + limits; no virtualization for large tables | P2 |
| Non-root container | COMPLETE | Web Dockerfile uses `nextjs` user | — |

---

### 17. Observability & Logging

| Item | Status | Evidence | Priority |
|------|--------|----------|----------|
| Structured JSON logging | MISSING | `console.log` / Hono logger only | P1 |
| Request ID / correlation ID | MISSING | — | P1 |
| OpenTelemetry tracing | MISSING | — | P1 |
| Metrics (Prometheus/etc.) | MISSING | — | P1 |
| SLO definitions | MISSING | — | P2 |
| Alerting | MISSING | — | P2 |
| Operational dashboards | MISSING | — | P2 |

---

### 18. Security Hardening (Platform)

| Item | Status | Evidence | Priority |
|------|--------|----------|----------|
| TLS | PARTIAL | Assumed at ingress; not configured in repo | P1 |
| Encryption at rest | MISSING | Not documented or enforced | P1 |
| Secret encryption / KMS | MISSING | Env vars + optional DB plaintext column | P0 |
| BYOK | MISSING | — | P3 |
| SSRF protection | MISSING | GitHub API calls only today; no generic URL fetch guard | P1 |
| Input sanitization | PARTIAL | Some manual validation; no framework-wide | P1 |
| Dependency scanning in CI | MISSING | CI runs lint/typecheck/test/build only | P1 |
| SAST / secret scan in CI | MISSING | — | P1 |
| Container scanning | MISSING | — | P1 |
| SBOM generation | MISSING | — | P2 |
| SECURITY.md | MISSING | — | P1 |
| Threat model documentation | MISSING | — | P1 |

---

### 19. Privacy & Data Lifecycle

| Item | Status | Evidence | Priority |
|------|--------|----------|----------|
| Data minimization (no source retention) | COMPLETE | File paths/metadata only in analysis | — |
| Retention policies | MISSING | — | P1 |
| Data deletion / export | MISSING | — | P1 |
| Privacy documentation | MISSING | — | P2 |

---

### 20. CI/CD & Testing

| Item | Status | Evidence | Priority |
|------|--------|----------|----------|
| CI pipeline | COMPLETE | Postgres + Redis services, full build + test | — |
| Unit tests | COMPLETE | All packages + API + worker have vitest tests | — |
| Tenant isolation tests | COMPLETE | `tenant-isolation.test.ts` | — |
| Golden path integration test | COMPLETE | `golden-path.test.ts` — webhook → queue → analysis → policy → passport | — |
| Security regression tests | MISSING | No SSRF, rate limit, injection suites | P1 |
| Load / performance tests | MISSING | — | P2 |
| Chaos / failure tests | MISSING | — | P2 |
| E2E browser tests | MISSING | — | P2 |
| CI security gates | MISSING | No SAST/SCA/secret/container scan | P1 |

**Test note:** Tests require live PostgreSQL and Redis. They pass in CI configuration; local execution depends on services being available.

---

### 21. Disaster Recovery & Operations

| Item | Status | Evidence | Priority |
|------|--------|----------|----------|
| Backup strategy | MISSING | — | P1 |
| Restore testing | MISSING | — | P1 |
| Incident response docs | MISSING | — | P1 |
| Runbooks | MISSING | — | P1 |
| Deployment documentation | MISSING | Docker compose only | P1 |
| Multi-region readiness | MISSING | — | P3 |
| Business continuity / degradation modes | MISSING | — | P2 |

---

### 22. Enterprise Integrations

| Integration | Status | Priority |
|-------------|--------|----------|
| GitHub App | COMPLETE | — |
| GitLab / Bitbucket / Azure DevOps | MISSING | P2 |
| SCIM 2.0 | MISSING | P0 |
| SAML / OIDC IdPs | MISSING | P0 |
| SIEM (Splunk, Sentinel, etc.) | MISSING | P2 |
| Slack / Teams / Email notifications | MISSING | P2 |
| Jira | MISSING | P3 |
| CLI (`aisdlc`) | MISSING | P2 |
| CI enforcement plugin | MISSING | P2 |

---

### 23. Billing & Entitlements

| Item | Status | Priority |
|------|--------|----------|
| Plan / entitlement model | MISSING | P2 |
| Usage metering | MISSING | P2 |

---

### 24. Code Quality & Architectural Risks

| Item | Status | Evidence | Priority |
|------|--------|----------|----------|
| Large commented-out code blocks | ARCHITECTURAL RISK | `app.ts`, `webhooks.ts`, `analyze.ts`, `github-oauth.ts`, `policy-management.ts`, `golden-path.test.ts`, etc. contain full duplicate commented sections | P2 |
| Manual Prisma delegate casts in webhooks | ARCHITECTURAL RISK | `webhooks.ts` uses hand-rolled types due to `aIActivity` casing | P2 |
| No centralized config validation | ARCHITECTURAL RISK | Missing secrets fail at runtime, not startup | P1 |
| Dist folders committed / present | ARCHITECTURAL RISK | `apps/*/dist`, `packages/*/dist` in workspace | P3 |

---

## Enterprise Readiness Gates (Spec §189)

| Gate | Status | Key Blockers |
|------|--------|--------------|
| **Gate 1 — Security** | **FAIL** | No rate limiting; worker tenant verification gap; no KMS; no SSO; `/health/queue-test` exposed |
| **Gate 2 — Reliability** | **FAIL** | Webhook processing not tracked; no reconciliation; graceful shutdown incomplete; no backups |
| **Gate 3 — Scalability** | **FAIL** | No connection pooling; single queue; no per-org fairness; offset pagination |
| **Gate 4 — Enterprise** | **FAIL** | No SSO/SCIM; no retention; no audit export; no org onboarding |
| **Gate 5 — Security Product** | **PARTIAL PASS** | Core pipeline works; mock security providers; no policy versioning/simulator |
| **Gate 6 — Operations** | **FAIL** | No structured logging, tracing, metrics, runbooks, or DR |

---

## Gap Priority Matrix

### P0 — Critical (address before any enterprise pilot)

1. **Worker job tenant verification** — validate org ownership chain in all worker DB operations
2. **Rate limiting** — at minimum on auth and webhooks
3. **Enterprise SSO architecture** — OIDC/SAML IdP abstraction (Milestone A)
4. **SCIM provisioning design** — user/group lifecycle (Milestone A)
5. **Secrets management** — remove plaintext secret storage; KMS abstraction
6. **Webhook reliability** — processing status, retry, reconciliation (Milestone B)

### P1 — Required for enterprise production

- API versioning, schema validation, idempotency keys
- Session revocation / server-side session store
- Database connection pooling
- Separate BullMQ queues + DLQ + job timeouts
- Policy versioning, dry-run mode, passport immutability
- Real security provider adapters (or explicit NOT_RUN — never mock-as-PASS in prod)
- Audit field expansion + export
- Organization onboarding flow (create org, invite members, domain verify)
- Environment/workspace model for policy scoping
- CI security scanning (SAST, SCA, secrets, containers)
- Structured logging + request/correlation IDs
- Remove or protect debug endpoints (`/health/queue-test`)
- Data retention and deletion architecture
- API keys and service accounts

### P2 — Important enterprise capability

- Policy simulator, decision replay, conflict detection
- AI agent registry and model governance
- ABAC / resource-level permissions
- Cursor pagination, search architecture
- Observability (OTel, metrics, dashboards, alerting)
- Notifications (Slack, email, webhooks)
- CLI and CI gate
- Load testing and capacity model
- Documentation suite (ARCHITECTURE, SECURITY, THREAT_MODEL, runbooks)
- Multi-SCM adapter framework
- Compliance evidence packages

### P3 — Future enhancement

- BYOK, multi-region, partitioning at scale
- OPA/Rego, advanced compliance frameworks mapping
- Feature flags, internal admin, break-glass access
- Billing integration

---

## What Is Already Implemented (Phases 0–15)

These capabilities are **working and should be preserved**, not rebuilt:

| Capability | Location |
|------------|----------|
| Modular monolith + worker split | `apps/api`, `apps/worker`, `packages/*` |
| PostgreSQL tenant schema | `packages/db/prisma/schema.prisma` |
| GitHub webhook ingest + dedup | `apps/api/src/webhooks.ts` |
| GitHub OAuth + signed sessions | `apps/api/src/auth/` |
| RBAC middleware | `apps/api/src/middleware/auth.ts` |
| Dashboard REST API | `apps/api/src/routes/` |
| PR analysis golden path | `apps/worker/src/processors/analyze.ts` |
| Risk engine v1 | `packages/risk` |
| Policy engine (static + DB) | `packages/policy` |
| Mock security providers + passport | `packages/security` |
| AI provenance inference | `packages/provenance` |
| GitHub Check Runs | `packages/github` |
| Next.js dashboard | `apps/web/app/dashboard/` |
| Tenant isolation tests | `apps/api/src/tenant-isolation.test.ts` |
| Golden path integration test | `apps/worker/src/golden-path.test.ts` |
| Append-only audit helper | `packages/db/src/audit.ts` |
| Docker Compose dev stack | `docker-compose.yml` |
| CI pipeline | `.github/workflows/ci.yml` |

---

## Recommended Implementation Order

Aligned with spec Milestones A–O, ordered by risk reduction and enterprise blocker removal:

```
Milestone A — Enterprise identity + RBAC + tenancy
  ├── OIDC/SAML IdP abstraction
  ├── SCIM 2.0 provisioning
  ├── Expand RBAC roles + resource-aware authorize()
  ├── Organization onboarding (create org, invites, domain verify)
  ├── Worker tenant verification + expanded isolation tests
  └── Server-side sessions with revocation

Milestone B — Webhook/event reliability
  ├── WebhookReceipt/Delivery/ProcessingAttempt models
  ├── Status lifecycle + processedAt updates
  ├── Retry + dead-letter + reconciliation cron
  └── Outbox pattern for critical events

Milestone C — Database + queue scalability
  ├── Connection pooling (PgBouncer)
  ├── Separate queues + per-org concurrency
  ├── Cursor pagination
  └── Index review for hot paths

Milestone D — Security hardening
  ├── Rate limiting (Redis-backed)
  ├── API v1 + Zod validation + idempotency
  ├── Remove/protect debug endpoints
  ├── KMS/secrets encryption
  ├── CSRF + request size limits
  └── CI security gates (SAST, SCA, secrets)

Milestone E — Audit + evidence integrity
  ├── Enterprise audit fields
  ├── Passport/policy immutability + versioning
  ├── Hash chain / tamper evidence
  └── Audit export

Milestone F — Enterprise integrations
  ├── API keys + service accounts
  ├── Notifications (Slack, email)
  └── SIEM webhook adapter

Milestone G — AI governance
  ├── AI agent registry
  ├── Provenance confidence model
  └── Model governance policies

Milestone H — Supply-chain security
  ├── Real security provider adapters
  ├── Finding lifecycle + risk acceptance
  └── SBOM/SCA ingestion adapters

Milestone I — Observability + SRE
  ├── Structured JSON logging
  ├── OpenTelemetry tracing
  ├── Metrics + dashboards + alerting
  └── Runbooks + incident response docs

Milestone J — Privacy + data residency
  ├── Retention policies
  ├── Data export/deletion
  └── Environment/workspace model

Milestone K — Compliance readiness
  ├── SECURITY.md, THREAT_MODEL.md, PENTEST_SCOPE.md
  ├── Control framework mapping (NIST SSDF)
  └── Production readiness checklist

Milestone L — Performance + load testing
  ├── Load test scenarios
  └── Capacity model document

Milestone M — Disaster recovery
  ├── Backup/restore automation
  └── DR documentation + restore tests

Milestone N — Enterprise UX
  ├── Admin console sections
  ├── Policy simulator UI
  └── Executive/compliance dashboards

Milestone O — Final adversarial security review
  └── Penetration test preparation + remediation
```

---

## Immediate Pre-Milestone Actions

Before starting Milestone A implementation:

1. **Do not claim production readiness** — current state is beta/MVP.
2. **Remove or gate `/health/queue-test`** in production builds.
3. **Fix worker tenant verification** — low-effort, high-impact P0 patch.
4. **Clean commented duplicate code** — reduces audit confusion and merge risk.
5. **Add startup config validation** — fail fast on missing `SESSION_SECRET`, `DATABASE_URL`, etc.
6. **Add `docs/` skeleton** — ARCHITECTURE.md, SECURITY.md as Milestone K precursors.

---

## Audit Conclusion

The AI-SDLC Control Plane has a **solid MVP foundation** with a working security analysis pipeline, meaningful tenant isolation on the HTTP surface, and good test coverage for the golden path. The codebase is well-structured for incremental hardening toward the enterprise modular-monolith target.

The gap to enterprise production is **large but well-defined**: identity (SSO/SCIM), API security controls, operational resilience (webhooks, queues, DR), observability, compliance architecture, and real security integrations are the primary workstreams. None of these require throwing away the existing implementation.

**Next step:** Proceed with **Milestone A — Enterprise identity + RBAC + tenancy** per the recommended sequence above.

---

*This audit is based on repository inspection as of 2026-09-19. Re-audit after each milestone.*
