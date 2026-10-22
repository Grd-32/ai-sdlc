# Nomalog AWS Deployment Readiness Audit

**Assessment date:** 2026-10-19

**Scope:** Repository-based assessment and deployment plan for a small MVP/beta using the existing
application architecture.
**Actions intentionally not taken:** No application or infrastructure code was changed, no
dependencies were installed, no AWS resources were created, and no production migrations were run.

## Executive summary

**Conclusion: a single EC2 instance running Docker Compose is a plausible first AWS beta topology
without changing the application architecture, but the repository is not yet production-ready.**
The existing Compose stack already separates the Next.js web app, Hono API, BullMQ worker,
PostgreSQL, and Redis. A reverse proxy can expose a single HTTPS origin while the application
containers and stateful service ports remain private to the Docker network.

The current Compose file is a local-development setup, not a safe production deployment definition:
it publishes PostgreSQL, Redis, API, web, and monitoring ports on the host; uses development
defaults; and has no HTTPS reverse proxy or production-specific secrets/volume/backup policy. The
repository has a basic local PostgreSQL dump/restore helper, but the dump is plaintext on local
disk and there is no automated cloud backup policy or documented successful production restore
drill. The worker has concurrency five, while the repository runbook says queue-depth, stalled-job,
and worker-health metrics and a dead-letter/reconciliation workflow are not currently exposed.

**Recommended initial topology:** one Linux EC2 instance in one Availability Zone, encrypted EBS,
Docker Compose, internal Docker networking for web/API/worker/PostgreSQL/Redis, and a Caddy or
equivalent reverse proxy exposing only TCP 80/443. Use AWS Systems Manager Session Manager for
administration rather than public SSH. Put database backups in a separately protected, encrypted
S3 bucket and test restores to a disposable environment. Build immutable container images in
GitHub Actions and store them in private Amazon ECR; pull/deploy them on EC2. Use GitHub Actions
OIDC for AWS access, not long-lived AWS access keys.

For a low-traffic beta, **2 vCPU / 8 GiB RAM is an experimental floor, not a comfortable
production target**. Start planning around **4 vCPU / 16 GiB RAM and 100–150 GiB encrypted
gp3 EBS**, then load-test representative assessments and monitor memory and disk before fixing
the production size. These are engineering estimates, not AWS instance/pricing claims. If local
container builds are performed on the instance, or large analysis jobs overlap, the floor is
likely insufficient. Build elsewhere.

The $100 credit amount does not establish that every service, region, data-transfer charge, public
IPv4 charge, marketplace image, or post-credit resource is covered. Obtain a current estimate and
confirm credit eligibility/expiry in the AWS account before provisioning. A one-instance deployment
is a single point of failure; it is appropriate only after an explicit beta-risk and recovery
decision, not as a high-availability or compliance claim.

### Evidence labels used below

- **Verified** — directly visible in repository files or configuration.
- **Inferred** — operational conclusion from the verified architecture or code.
- **Not verified** — repository inspection cannot establish this fact.
- **AWS account inspection required** — depends on account, region, service limits, or current
  commercial terms.

## 1. Repository architecture and exact locations

### Monorepo and applications

| Evidence | Location |
| --- | --- |
| **Verified:** root scripts, package manager `pnpm@9.15.0`, Node engine range `>=20` | [`package.json`](../package.json) |
| **Verified:** workspace patterns `apps/*` and `packages/*` | [`pnpm-workspace.yaml`](../pnpm-workspace.yaml) |
| **Verified:** shared lockfile | [`pnpm-lock.yaml`](../pnpm-lock.yaml) |
| **Verified:** Next.js 15 / React 19 app, standalone output config | [`apps/web/package.json`](../apps/web/package.json), [`apps/web/next.config.ts`](../apps/web/next.config.ts) |
| **Verified:** Hono API app, production entry command `node dist/index.js` | [`apps/api/package.json`](../apps/api/package.json), [`apps/api/src/index.ts`](../apps/api/src/index.ts) |
| **Verified:** BullMQ worker app, production entry command `node dist/index.js` | [`apps/worker/package.json`](../apps/worker/package.json), [`apps/worker/src/index.ts`](../apps/worker/src/index.ts) |
| **Verified:** shared packages: billing, db, github, policy, provenance, risk, security, source-control | [`packages/`](../packages) |

### Container and environment configuration

| Evidence | Location |
| --- | --- |
| **Verified:** API multi-stage Node 20 Alpine Dockerfile, workspace build and runtime image | [`apps/api/Dockerfile`](../apps/api/Dockerfile) |
| **Verified:** web multi-stage Dockerfile, Next standalone runtime; public Next variables are build arguments | [`apps/web/Dockerfile`](../apps/web/Dockerfile) |
| **Verified:** worker multi-stage Node 20 Alpine Dockerfile, generated Prisma Client and package builds | [`apps/worker/Dockerfile`](../apps/worker/Dockerfile) |
| **Verified:** local Compose file defines PostgreSQL, Redis, API, worker, web, OpenTelemetry Collector, Prometheus, Grafana | [`docker-compose.yml`](../docker-compose.yml) |
| **Verified:** environment examples/defaults, with no secret values reproduced in this report | [`.env.example`](../.env.example) |
| **Verified:** no centralized environment validation schema found (for example, Zod/envalid/Joi schema). Runtime modules read environment variables directly and some validate lazily when used. | [`apps/api/src/config.ts`](../apps/api/src/config.ts), [`apps/worker/src/config.ts`](../apps/worker/src/config.ts), [`packages/github/src/index.ts`](../packages/github/src/index.ts), [`packages/source-control/src/credentials.ts`](../packages/source-control/src/credentials.ts) |
| **Verified:** local observability configuration | [`observability/`](../observability) |

There is one Compose file, [`docker-compose.yml`](../docker-compose.yml); no production override,
AWS deployment manifest, EC2 bootstrap script, or Render/AWS-specific deployment workflow was
found in the inspected repository.

### Database, health, lifecycle, and CI

| Evidence | Location |
| --- | --- |
| **Verified:** PostgreSQL Prisma schema; datasource uses `DATABASE_URL` only | [`packages/db/prisma/schema.prisma`](../packages/db/prisma/schema.prisma) |
| **Verified:** 28 checked-in SQL migrations; migration lock is PostgreSQL | [`packages/db/prisma/migrations/`](../packages/db/prisma/migrations), [`packages/db/prisma/migrations/migration_lock.toml`](../packages/db/prisma/migrations/migration_lock.toml) |
| **Verified:** Prisma CLI and Client resolve to 6.19.3 in the installed workspace state | [`packages/db/package.json`](../packages/db/package.json) |
| **Verified:** liveness `GET /health`; readiness `GET /health/ready` checks DB and Redis | [`apps/api/src/app.ts`](../apps/api/src/app.ts) |
| **Verified:** worker has no HTTP listener/health endpoint; startup registers scheduled jobs then starts BullMQ with concurrency five | [`apps/worker/src/index.ts`](../apps/worker/src/index.ts), [`apps/worker/src/worker.ts`](../apps/worker/src/worker.ts) |
| **Verified:** API and worker handle SIGTERM/SIGINT and close their server/queue/telemetry connections | [`apps/api/src/index.ts`](../apps/api/src/index.ts), [`apps/worker/src/index.ts`](../apps/worker/src/index.ts) |
| **Verified:** a daily retention, risk-acceptance-expiry, and finding-SLA scheduler is registered through Redis/BullMQ | [`apps/worker/src/retention-scheduler.ts`](../apps/worker/src/retention-scheduler.ts) |
| **Verified:** CI runs PostgreSQL and Redis services, generates Prisma Client, deploys migrations into CI's disposable PostgreSQL, then format/typecheck/lint/build/test | [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) |

The existing CI workflow is a validation workflow; it does not build/publish versioned production
images, access AWS, deploy services, gate production migrations, or perform post-deploy health
checks.

### Existing operations, deployment, and recovery documentation

| Evidence | Location |
| --- | --- |
| Local/Compose operations runbook; explicitly not a production escalation policy | [`docs/OPERATIONS_RUNBOOK.md`](OPERATIONS_RUNBOOK.md) |
| Disaster recovery guidance; production backup schedule, retention, RPO/RTO, and restore drill remain open | [`docs/DISASTER_RECOVERY.md`](DISASTER_RECOVERY.md) |
| Previous Render/Supabase preparation; useful workspace and provider topology context, not an AWS plan | [`docs/DEPLOYMENT_RENDER_SUPABASE.md`](DEPLOYMENT_RENDER_SUPABASE.md) |
| Backup helper uses `pg_dump` and writes a timestamped plaintext SQL file under `./backups/` | [`scripts/db-backup.mjs`](../scripts/db-backup.mjs) |
| Restore helper invokes `psql -f` against the configured `DATABASE_URL`; it does not confirm target identity or isolate/rollback a partial restore | [`scripts/db-restore.mjs`](../scripts/db-restore.mjs) |
| GitHub Actions workflow inventory | [`.github/workflows/`](../.github/workflows) |

No AWS-specific deployment documentation, production Compose definition, backup automation to S3,
or production restore test evidence was found. This is **not verified** for any AWS account or
deployed environment.

## 2. Can the existing applications run together on one EC2 instance?

**Verified:** Compose already orchestrates all required runtime components: web, API, worker,
PostgreSQL, and Redis. The app images are separately buildable using their Dockerfiles. The
application has no demonstrated dependency on a managed AWS-specific service.

**Inferred:** The architecture can run on one EC2 host using Docker Compose without replacing
Next.js, Hono, BullMQ, Prisma, PostgreSQL, or Redis. It does require a production Compose
configuration and operational controls. Do not use the current local Compose file unchanged:

- It publishes ports for PostgreSQL, Redis, API, web, Prometheus, and Grafana onto the host.
- It contains development-mode service configuration and local defaults.
- It has persistent named volumes for PostgreSQL and Redis, but volume persistence is not backup.
- It does not define an HTTPS reverse proxy or production health/restart/deployment policy.
- The existing API readiness endpoint does not report worker health or queue backlog.
- Prometheus/Grafana/Collector are optional operational services, but their current exposed ports
  and local-oriented configuration are not an Internet-facing production monitoring plan.

For a one-host production topology, place all app services on a private Docker network. Publish
only the reverse proxy's HTTP/HTTPS ports. Do not publish PostgreSQL `5432`, Redis `6379`, or
application ports directly on the EC2 interfaces. If a separate security group is misconfigured,
an unbound-to-loopback Compose port mapping can become reachable from outside.

### Single-host trade-offs

- One instance and one Availability Zone make the host, its EBS volume, and its AZ a single failure
  domain. Instance replacement, volume failure, mistaken deletion, or an AZ incident requires
  recovery from backups.
- Local PostgreSQL avoids RDS cost/complexity but makes disk monitoring, database backups, patching,
  replication strategy, and restore drills the operator's responsibility.
- Redis is essential to active BullMQ processing. Its persistence and queue recovery behavior need
  deliberate configuration and testing; a PostgreSQL restore alone does not restore Redis jobs.
- Docker Compose is simple for a beta but does not provide multi-host scheduling, managed
  failover, or zero-downtime rolling deployments.

## 3. Resource sizing assumptions

The following are **engineering planning estimates**, not measured Nomalog load-test results or
AWS instance recommendations. Actual usage depends on repository count, pull-request size,
assessment concurrency, AI-provider calls, PostgreSQL retention, log volume, and Docker image size.

| Component | MVP/beta planning allowance | Main pressure sources |
| --- | --- | --- |
| Linux host, Docker daemon, reverse proxy, monitoring agent | 1.5–2.5 GiB RAM reserved | OS page cache, container runtime, log buffering, security/SSM agent |
| Next.js web | 0.5–1.5 GiB | Server rendering, route concurrency, startup/build work |
| Hono API | 0.5–1.5 GiB | Concurrent HTTP requests, Prisma, webhook parsing, telemetry |
| Worker | 1.5–4+ GiB | Worker concurrency is currently 5; diff and assessment processing can overlap and hold provider/API response data |
| PostgreSQL | 1.5–4 GiB | Shared buffers, connection pools from both API and worker, query/sort memory, cache |
| Redis | 0.25–1+ GiB | BullMQ job payloads, retries, delayed/scheduled jobs, queue growth |
| Headroom / bursts | 2–4 GiB | Linux cache, deploy restarts, spikes, and unmodelled per-job memory |

**Inferred sizing:**

- **2 vCPU / 8 GiB RAM:** lowest plausible pilot for low traffic, one worker, low concurrency of
  submitted work, and builds performed outside EC2. It has little safety margin if several
  assessments/large diffs overlap.
- **4 vCPU / 16 GiB RAM:** more credible initial beta target with room for service overlap and
  analysis bursts. This still requires load testing and does not guarantee capacity.
- **More CPU/RAM:** may be required for larger PR diff batches, multiple repositories running
  assessments simultaneously, or meaningful concurrent analysis. The worker's concurrency is
  configured in code rather than via an environment setting identified in the repository.

**Disk:** plan for an encrypted **100–150 GiB gp3 EBS** starting point, then measure. The volume
must hold the OS, Docker layers and old release images, PostgreSQL data/WAL, Redis files, logs, and
temporary operational space. Do not store backups only on the same EBS volume. Keep database data
and logs on monitored persistent storage; configure log rotation and image cleanup that cannot
delete the live release. Assess DB growth/retention and leave free-space headroom. Do not commit
production SQL dumps into the repository.

**Build contention:** the Dockerfiles compile shared packages and Next.js. A build on the
production host competes with the database and worker for CPU, memory, and disk, and may cause
out-of-memory termination or request/job latency. Build containers in GitHub Actions and deploy
prebuilt images instead.

Before fixing instance size, run a representative staging load: concurrent webhook events,
realistic pull-request diff sizes, one or more assessment runs, database reads/writes, and queue
backlog recovery. Measure peak memory, CPU, EBS free space and I/O, API latency, DB connections,
and job completion time. These measurements were **not performed for this audit**.

## 4. Proposed minimal AWS architecture

### Network and public ingress

1. Use a VPC with a public subnet for the single EC2 host and an Internet Gateway. VPC constructs
   themselves may have no base charge, but public IPv4, data transfer, and optional network services
   can incur costs; verify in the account and pricing calculator.
2. Assign a stable address only after checking current public IPv4/EIP pricing and the operational
   need for a stable origin. Point a domain/subdomain A record to the address.
3. Security Group inbound: TCP 80 and 443 from the required public ranges. Do not allow inbound
   PostgreSQL, Redis, web, API, Grafana, Prometheus, or collector ports.
4. Prefer Systems Manager Session Manager and an instance IAM role for administration; do not
   expose TCP 22 to the Internet. Verify SSM agent/permissions and its network path. A NAT Gateway
   is not required for a simple public-subnet egress design and should be avoided initially unless
   private-subnet architecture requires one.
5. Restrict outbound access where operationally feasible to package/image registries, GitHub and
   configured providers, AWS Systems Manager/CloudWatch/S3/ECR endpoints, DNS, and certificate
   services. The exact egress policy needs an integration test before tightening.

### EC2, storage, Compose, and TLS

- One Amazon Linux or supported Ubuntu EC2 host. Enable IMDSv2, attach a least-privilege instance
  role, apply OS security updates, use encrypted EBS, and restrict administrative access.
- Use an externalized release directory and a reviewed production Compose file. Bind only the
  reverse proxy to host `80/443`; keep web, API, worker, PostgreSQL, and Redis on internal
  Compose networking. Give PostgreSQL its own persistent EBS-backed Docker volume. Treat Redis as
  queue state and validate AOF/RDB persistence/recovery requirements explicitly.
- Use Caddy or another maintained reverse proxy for HTTPS certificates and HTTP-to-HTTPS
  redirection. Confirm automatic certificate issuance/renewal and DNS reachability before enabling
  the GitHub App. Let's Encrypt certificates avoid a paid load balancer solely for TLS, but DNS and
  EC2 networking still have potential AWS charges.
- For one host, use one public hostname. Next.js handles its same-origin OAuth/API proxy paths.
  Route GitLab and Stripe webhook paths that exist only in the API to the API container; preserve
  Next.js webhook proxies for GitHub, Bitbucket, and Azure DevOps or deliberately route all webhook
  paths to the API after confirming the integrations. Never route or forward unsigned data in a way
  that bypasses the existing verification.
- Keep Docker's published service ports absent in production Compose. A Security Group is not a
  substitute for private container networking.

### Data, queue, logs, and backups

- PostgreSQL and Redis stay on the same host for this cost-conscious first deployment. This is
  operationally simple but couples their availability and resource pressure. Do not assume
  PostgreSQL data in a Docker volume is backed up.
- Create encrypted, timestamped PostgreSQL backups and transfer them to an S3 bucket in a separate
  recovery boundary. Configure least-privilege bucket access, encryption, retention/lifecycle,
  public-access block, and optionally versioning/object lock if its cost and retention implications
  are acceptable. Keep encryption keys and source-control encryption keys backed up separately.
- Decide whether Redis needs AOF, RDB, or to be treated as reconstructible. Existing configuration
  has a Redis named volume but no explicit production durability/recovery policy. Test queue
  processing after Redis loss; do not delete or flush Redis in production as a routine recovery.
- Send container stdout/stderr to a controlled log destination, such as CloudWatch Logs, with
  explicit retention and access controls. Application logs contain request paths/IDs and worker
  job/record IDs and error messages. Do not include cookies, OAuth tokens, webhook secrets,
  private keys, or database URLs in logs. CloudWatch ingestion, storage, metrics, and alarms can
  incur charges.
- Monitor EC2 status checks, CPU, memory (requires an agent/custom metrics), EBS free space/I/O,
  PostgreSQL health, `/health/ready`, reverse-proxy certificate expiry, worker process status, and
  BullMQ queue depth/oldest job age. The existing API readiness endpoint only checks DB and Redis;
  worker health and queue backlog need separate operational observation.

### Domain, OAuth, GitHub, and provider callbacks

**Verified:** auth callbacks are proxied through the Next.js app under `/api/auth/...`; the API's
GitHub OAuth callback uses `GITHUB_APP_CALLBACK_URL` for token exchange. GitHub App setup callback
also has a web route. API CORS is restricted to `APP_URL` and credentialed requests.

For a single public domain `https://<app-domain>`:

- Set `APP_URL` to the canonical HTTPS web origin.
- Register GitHub user OAuth callback as
  `https://<app-domain>/api/auth/github/callback`.
- Register GitHub App setup URL as
  `https://<app-domain>/api/github/installations/callback`.
- Configure the GitHub App webhook URL to the selected verified route (normally
  `https://<app-domain>/api/webhooks/github`) and keep the webhook secret identical between GitHub
  and the API environment.
- Register GitLab, Bitbucket, and Azure DevOps callback routes on the same web hostname only when
  those integrations are enabled.
- Configure GitLab/Stripe webhook routes to the API via the reverse proxy, since no matching
  Next.js webhook proxy was found for those two integrations.
- Set `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_API_URL`, and `NEXT_PUBLIC_GITHUB_APP_SLUG` consistently
  at build/runtime as required by the existing Next.js build and proxy configuration. Public
  `NEXT_PUBLIC_*` variables are not secrets and may be embedded in the built image.

The domain owner, DNS registrar, TLS, GitHub App settings, OAuth credentials, and webhook delivery
were **not verified**.

## 5. Build on EC2 versus Amazon ECR

| Approach | Cost | Security/operations | Assessment |
| --- | --- | --- | --- |
| Build on EC2 after Git checkout | Avoids ECR storage/transfer and a registry setup, but the EC2 instance pays the build-resource opportunity cost. It may also need larger disks and can accumulate old layers. | Requires source/development dependencies and build tooling on the production host; build competes with live services; release is less reproducible; rollback depends on retaining local images. | Suitable only for disposable experiments with stopped services and well-controlled access. Not recommended for an exposed beta host. |
| Build in GitHub Actions, publish to private ECR, pull on EC2 | ECR storage and image transfer can incur charges; GitHub Actions usage/limits also need account/plan verification. | Immutable commit/digest tags, clean production host, faster repeatable deployments, easier rollback and provenance; requires repository IAM/OIDC setup, ECR login and lifecycle policy. | **Recommended.** Build once in CI, tag by full commit SHA, deploy the same digest to staging and production. |

Do not use mutable `latest` as the only release identifier. Keep a small bounded set of known-good
images and configure an ECR lifecycle policy after selecting retention/rollback requirements.
ECR is not required for Compose itself; this recommendation is about reproducibility and
operational safety.

## 6. GitHub Actions deployment workflow design

Extend the existing CI workflow only after the infrastructure and environments are approved.
Keep PR validation independent from production permissions.

1. **Pull request validation:** checkout; install pinned pnpm with frozen lockfile; generate
   Prisma Client; provision disposable PostgreSQL/Redis; apply migrations only to the CI database;
   run format, typecheck, lint, tests, and production builds. Do not attach production AWS IAM
   access or production secrets to pull-request jobs.
2. **Build after merge:** use GitHub Actions OIDC with a narrowly scoped AWS IAM role. Build the
   three Docker images using existing Dockerfiles, tag them with full commit SHA and release
   metadata, and push to private ECR. Pin deployment to immutable image digests. Do not pass runtime
   secrets as Docker build arguments; only public Next.js config belongs in public build args.
3. **Stage:** deploy the exact built digests to a staging instance/environment using SSM Run
   Command (no inbound SSH and no static AWS access keys). Verify container health, web routes,
   `/health`, `/health/ready`, queue processing, OAuth/webhook configuration, and logs using
   non-production credentials.
4. **Production approval:** require a protected GitHub Environment with human approval and
   branch restrictions. The deployment role may read/pull approved ECR images and invoke a
   limited, audited SSM command on the designated instance; it should not have broad account admin
   permissions.
5. **Migration gate:** review generated SQL and migration order before any release. Establish a
   current, verified database backup and a maintenance/recovery plan. Prefer expand/contract
   schema changes that are compatible with both the currently running and candidate app versions.
   Run `prisma migrate deploy` once as an explicit one-off migration step using the candidate
   release's Prisma schema/client and the production database secret. Do not run it on every
   Compose service startup or from multiple replicas. For risky/destructive changes, require a
   separately approved migration window and tested restore path.
6. **Deploy:** pull pinned digests, update the release Compose file, and recreate services in a
   controlled order. Keep the previous image digests and configuration available. For compatible
   migrations, start API/web/worker and wait for health and job consumption.
7. **Post-deployment checks:** poll `/health` and `/health/ready`; verify web public routes,
   login/session cookie behavior, webhook signature rejection/acceptance using safe test deliveries,
   database connectivity, worker startup, queue backlog movement, and error logs. Do not use an
   endpoint that creates production test data unless its cleanup and authorization are established.
8. **Failure handling:** stop automatic rollout, preserve logs and the failed release digest, and
   determine whether the failure is app-only or schema/data related. Roll back the app image only
   when the current database schema remains backward-compatible. If the migration is destructive
   or data is damaged, do not attempt an app-only rollback; follow the approved database restore or
   forward-fix plan.

Store runtime secrets in a dedicated secrets system or encrypted SSM parameters with a least
privilege instance role; do not expose them to GitHub PR jobs or print them in workflow output.
For a beta where costs matter, compare Parameter Store SecureString/KMS and Secrets Manager costs
in the account; do not assume either is covered by credits. If a protected host-side environment
file is used temporarily, restrict file ownership/mode, keep it outside the repo and image build
context, and avoid emitting `docker inspect` or environment dumps into CI logs.

## 7. AWS cost exposure

No AWS prices are asserted here. Confirm region-specific current rates, taxes, account credits,
eligibility, quota and billing behavior in the AWS console and pricing calculator before creating
resources. A budget alert is not a hard spending cap; configure notifications and review actual
usage.

### Essential for the proposed one-host architecture

| Service/resource | Why needed | Cost/eligibility check |
| --- | --- | --- |
| EC2 instance | Runs Compose and all application/data services | Instance family/size, OS/software, region, runtime hours, current free-tier eligibility, and credit coverage all require account verification. |
| EBS encrypted volume | OS, images, PostgreSQL, Redis, logs | Volume size/type, snapshots, provisioned performance, KMS key type, and backups require pricing verification. |
| Public IPv4 / stable address | Internet reachability and DNS target | Public IPv4/EIP charges and idle/address rules must be checked. |
| Internet egress/data transfer | GitHub/provider APIs, image pulls, application traffic, backups | Usage-dependent charges and transfer direction/region must be checked. |
| Domain/DNS | Stable OAuth/webhook hostname | Domain registration and hosted-zone/query pricing depend on registrar and provider; verify. |
| ECR private registry (recommended) | Versioned image storage and deploy pulls | Image storage, transfer and lifecycle retention have possible charges. |
| S3 backup bucket (recommended) | Off-instance recoverable database dumps | Storage, requests, retrieval, replication, encryption, lifecycle, and egress may incur charges. |
| CloudWatch Logs/alarms (recommended minimum) | Central service logs and operational alerts | Ingestion, storage, custom metrics, dashboards, alarms, and retention all require verification. |

VPC, subnet, route table, Internet Gateway, Security Groups, IAM roles, and GitHub OIDC have no
per-service charge in many common configurations, but associated public IPv4, endpoints, NAT,
logging, or other use can cost money. Verify the specific arrangement; do not infer zero cost from
the service name.

### Optional; explicitly price before enabling

- AWS Secrets Manager, Parameter Store SecureString/KMS, AWS Backup, EBS snapshots, S3 versioning
  or Object Lock, CloudWatch custom metrics/dashboards, CloudTrail data events, Route 53 hosted
  zone/domain, SES, and a managed database/queue.
- SSM VPC interface endpoints if choosing private subnets with no public egress.
- AWS WAF, GuardDuty, Security Hub, Inspector, and additional threat-detection or compliance
  services.
- Managed services such as RDS for PostgreSQL or ElastiCache for Redis would reduce some
  operational responsibility but add service cost and are outside the minimal single-host design.

### Avoid in the first deployment unless there is a specific need and budget

- NAT Gateway for a single public-subnet host; it adds a fixed and data-processing cost. Do not
  replace it with an unprotected public management port.
- Application Load Balancer or Network Load Balancer for one instance when Caddy/Let's Encrypt
  provides the necessary single-host TLS/routing; revisit when high availability or scale is
  required.
- EKS/Kubernetes, multi-AZ application/database/Redis clusters, multiple environments that run
  continuously, paid observability stacks, and oversized instances before measured need.
- Public PostgreSQL/Redis, public Grafana/Prometheus, and direct public container ports; these are
  security risks, not cost-saving options.

**Credits:** whether the $100 applies to EC2, EBS, ECR, IPv4, S3, CloudWatch, support, taxes,
marketplace items, or all usage in the selected account/region is **AWS account inspection
required**. Set billing notifications before deployment and review service-by-service usage.

## 8. Production risks and controls

| Area | Repository evidence / risk | Required control before beta |
| --- | --- | --- |
| Tenant isolation | Application authorization and tenant isolation tests exist. No `ENABLE ROW LEVEL SECURITY` or `CREATE POLICY` statements were found in checked-in DB migrations. | Treat application scoping as the tenant boundary; review authorization-critical routes and test cross-tenant denial against staging. Do not assume Supabase/PostgreSQL RLS protects tenants. |
| Database/Redis exposure | Current Compose publishes PostgreSQL and Redis ports on the host. | Production Compose must not publish them. Internal Docker network only; SG inbound only 80/443; verify externally with a port scan from an authorized test host. |
| Encryption key persistence | Source-control OAuth tokens and webhook secrets use AES-256-GCM with `SOURCE_CONTROL_ENCRYPTION_KEY`; the value must be base64 for 32 bytes. | Generate once, store in a protected secret store, back it up independently, restrict access, and preserve through rebuild/restore. Rotation requires a re-encryption plan; losing it can make stored credentials unreadable. |
| GitHub webhook verification | GitHub endpoint verifies HMAC; other provider handlers use provider/connection auth. | Preserve the exact raw body and required signature/auth headers through the reverse proxy; configure secrets only at runtime; test invalid-signature rejection and valid delivery. Never disable verification to debug. |
| OAuth callback/domain | Callback values must agree exactly with provider app settings and the public HTTPS origin; API CORS uses `APP_URL`. | Use canonical HTTPS domain; update GitHub App user callback, setup URL, webhook URL, and optional provider callbacks; test state cookies and login with a production-like browser. Keep callback and `APP_URL` configuration aligned. |
| Queue durability/retries | BullMQ runs on Redis; worker concurrency is five. Repository runbook documents five attempts with exponential backoff, but reports no queue-depth/stalled-job metrics or DLQ/reconciliation workflow. | Set Redis persistence/recovery deliberately; alert on oldest job, failed/stalled count and backlog; prove webhook/job idempotency and recovery after worker/host restart. Limit simultaneous high-cost assessments operationally until measured. |
| Migration safety | CI applies migrations only to its disposable PostgreSQL. The schema has 28 migrations and historical destructive column drops. No down-migration mechanism is present in Prisma migrations. | Back up and verify before change; review exact SQL; use expand/contract; migrate once with approval before app rollout; test old/new app compatibility. Treat rollback after destructive migration as restore/forward-fix, not image rollback. |
| Backup/restore | Current `db:backup` writes a plaintext `.sql` into local `backups/`; restore pipes a supplied SQL file to the chosen database with no target confirmation. Docs say no production schedule or tested recovery objective exists. | Do not rely on the local helper as a complete production backup plan. Encrypt off-host backups, restrict access/retention, verify checksums, perform timed restore drills into isolated PostgreSQL, and document RPO/RTO and owner. Keep restore credentials separated. |
| Backup helper credential handling | `db-backup.mjs` and `db-restore.mjs` pass the full database URL as a child-process argument to `pg_dump`/`psql`. Process arguments can be visible to privileged/local processes. | Review before using against production. Prefer a secure credential mechanism (for example, libpq environment/service file with strict permissions) and avoid process listings/logs that disclose connection strings. |
| Logs and telemetry | API logs method/path/status/request IDs; worker logs job names/IDs and errors. Runbook acknowledges telemetry gaps. | Set short, purposeful retention and least-privilege access; avoid payloads, secrets, source diffs and personal data; verify provider/library error messages are sanitized. Monitor memory/disk and use alerts. |
| Graceful shutdown | API and worker handle SIGTERM/SIGINT. API closes queue connections before closing the HTTP server; no bounded shutdown deadline is evident. | Test EC2/Compose restart with in-flight requests/jobs. Confirm proxy timeout and Docker stop grace exceed expected shutdown; consider ordering/timeout hardening only in a later implementation task. |
| Single-host availability | All state and runtime share one EC2/EBS/AZ failure domain. | Explicitly accept beta downtime/data-loss risk, maintain off-host backups, and rehearse instance/volume recovery before real customer data. |

## 9. Safe deployment sequence

This sequence deliberately does **not** modify a production database before infrastructure is
ready:

1. **Approve scope and risk:** confirm beta users, data classification, acceptable downtime, RPO/RTO,
   region, monthly budget guardrails, credit eligibility and owner/on-call responsibility.
2. **Inspect/prepare AWS account:** verify region and account access, billing alerts, credit expiry,
   service quotas, domain ownership and least-privilege IAM roles. Do not create the production DB
   or run a migration as part of this step.
3. **Design production config:** prepare a separate production Compose file, secrets delivery,
   network/firewall rules, reverse-proxy routing, persistent volume paths, log rotation and
   service health/restart behavior. Keep development Compose behavior intact.
4. **Build and test deployable images:** use GitHub Actions on PRs and merge; tag images by commit
   SHA; publish to private ECR using OIDC. Scan images/dependencies and retain release metadata.
   Confirm builds use the same frozen lockfile and Prisma generation path.
5. **Provision a non-production environment:** create minimal isolated network/instance/storage,
   DNS/TLS test hostname, ECR, logging, and backup bucket/policy. Do not attach customer data.
6. **Deploy staging and test:** use sanitized/fixture data and test provider apps. Exercise
   login/OAuth, GitHub installation callback, valid and invalid webhook signatures, queue retries,
   worker restarts, assessment, retention scheduler, health checks, backup upload, and full restore
   drill. Load-test and size the host.
7. **Review production SQL and migration plan:** compare the target schema/history and all pending
   migration files; review destructive operations and compatibility. No migration runs until
   this review, a production backup plan, and human approval are complete.
8. **Prepare production infrastructure without schema changes:** provision the production EC2,
   encrypted EBS, security group, DNS/TLS, Compose networks, secret references, monitoring,
   backup destination, and pinned release images. Confirm the host can reach DB/Redis endpoints and
   has sufficient disk; keep app traffic disabled or restricted to an internal smoke-test window.
9. **Create/verify database backup and recovery path:** if there is no existing production data,
   record the empty initial state and verify the isolated restore path first. If the DB has data,
   take and verify an off-host backup and review the migration-history match before touching it.
10. **Apply initial schema/migrations once:** a designated operator executes `prisma migrate deploy`
    against the explicitly verified target with the approved migration credential. Capture
    migration status/output without connection strings. Do not run `migrate dev` or `db push`.
11. **Start application and smoke-test privately:** start API, web, worker and reverse proxy with
    non-public routing or restricted allowlist; verify `/health/ready`, database access, queue
    processing, OAuth cookie/callback flow, and provider test deliveries.
12. **Open public traffic:** update DNS/ingress, verify TLS renewal path, callback/webhook deliveries,
    logs, alarms, and backup schedule. Confirm billing usage and resource utilization after launch.

## 10. Rollback and recovery strategy

### Application release rollback

- Retain the previous known-good image digests and matching release configuration.
- For an application-only regression with a backward-compatible schema, redeploy the previous
  image set via SSM/Compose, then verify `/health`, `/health/ready`, web login and worker queue
  behavior.
- Keep the worker and API release versions compatible with queue job payloads. A worker rollback
  may not understand jobs already enqueued by newer code; assess job schema changes before release.
- Do not delete Redis state or reset volumes to force a rollback.

### Database recovery

- A container-image rollback does not reverse a Prisma migration. Prisma migrations in this repo
  have no automatic down scripts; destructive changes can make the previous app incompatible.
- For a compatible migration failure, stop rollout and use a reviewed forward fix if safe.
- For data corruption or a non-backward-compatible migration, stop writes, preserve forensic
  evidence, select a verified backup/PITR point if configured, and restore to an isolated volume or
  replacement instance first. Validate schema, tenant boundaries, audit records, counts, and
  application health before switching traffic.
- Preserve the original EBS volume/snapshot and database files until recovery is approved. Do not
  overwrite the only copy. Document expected data loss from the backup point and obtain approval
  before DNS/volume cutover.
- Redis loss may mean queued/delayed work is lost even if PostgreSQL is restored. Reconcile
  webhook/job records and re-enqueue only through an approved idempotent mechanism; the repository
  currently does not document a full production reconciliation/DLQ procedure.

### Recovery objectives

RPO, RTO, backup cadence, backup retention, restore owner and customer communications are not
defined by repository evidence. Decide and test these before onboarding real customer data.

## 11. Outstanding decisions and unverified facts

### Decisions required from the deployment owner

1. Is a one-instance, one-AZ beta and its downtime/data-loss exposure acceptable?
2. Which region and domain will be used, and who owns DNS/certificate/callback configuration?
3. What monthly spending limit and alert recipients should be set? How long do the $100 credits
   remain available, and which services/regions are eligible?
4. Which source-control providers, email, Stripe, and AI review features are enabled at launch?
5. What are the beta's data retention, backup cadence, RPO/RTO, and restore approval requirements?
6. Should AWS-hosted PostgreSQL and Redis remain in containers initially, or is the beta budget
   sufficient for managed database/queue services?
7. Who approves database migrations, production deploys, secret rotation, and disaster recovery?

### Requires AWS account inspection

- Current EC2, EBS, ECR, public IPv4, data transfer, S3, CloudWatch, DNS/domain, KMS, SSM, and
  optional managed-service pricing for the chosen region.
- Whether this account has the stated credits, their expiry and eligible services, free-tier
  eligibility, billing alerts, quotas, support plan, and any restrictions.
- IAM identity/permission boundaries, organization SCPs, CloudTrail configuration, and SSM access.
- VPC/subnet/IP availability, EBS encryption defaults, selected AMI support lifecycle, and domain
  ownership.

### Not verified by this repository audit

- Actual production traffic, representative worker/API/DB memory usage, queue throughput or
  performance on an AWS instance.
- Existing AWS resources, account settings, DNS, GitHub App settings, OAuth credentials, webhook
  delivery, backup contents, restore success, or production database state.
- Runtime environment completeness on a future host; there is no single validation schema.
- Current AWS prices, credit eligibility, and free-tier terms.

Passing the repository's tests or running the local Compose stack is not evidence that the AWS
deployment, security boundaries, production migration, backups, recovery objectives, or
production readiness have been validated.
