# Nomalog AWS Cost-Constrained MVP Implementation Plan

**Assessment date:** 2026-10-19

**Purpose:** Plan a small, controlled AWS beta using the existing application and an available AWS
credit balance reported as $100.

**Planning only:** This report does not change application files, create AWS resources, run
production migrations, install dependencies, or claim that either deployment profile fits the
credit balance.

## Evidence and decision labels

- **Verified repository fact** — directly visible in current repository files.
- **Engineering estimate** — planning assumption that needs measurement.
- **Unresolved decision** — deployment owner must select/approve.
- **AWS account / Pricing Calculator verification required** — price, credit, quota, or eligibility
  cannot be determined from the repository.

This plan uses the completed [AWS Deployment Readiness Audit](AWS_DEPLOYMENT_READINESS.md) and
rechecks relevant current repository files. The workspace already has local edits in
`docker-compose.yml`, `.env.example`, and `.github/workflows/ci.yml`; this planning task leaves
those files unchanged.

## Executive recommendation

Start with **Profile A (2 vCPU / 8 GiB RAM) as a short-lived, low-concurrency staging/beta
validation profile**, not as an assumed production capacity. Test a production-shaped Compose
deployment, backup/restore, health monitoring, and one-at-a-time representative analysis workload.
Move to **Profile B (4 vCPU / 16 GiB RAM)** if Profile A fails the explicit performance gates below,
or if the beta requires overlapping assessments. The worker currently runs with concurrency five,
so its resource demand may exceed the smaller host when multiple heavy jobs overlap.

Both profiles have the same single-EC2, single-AZ failure domain and operational responsibilities.
Profile B offers more compute/memory headroom but does not itself provide high availability,
durable backups, or production readiness. Costs depend on the selected region, instance type,
storage, public IPv4, network use, image/log/backup volume, and actual credit terms. **Neither
profile can be declared covered by $100 until checked in the AWS Pricing Calculator and the actual
account.**

## 1. Compare deployment profiles

| | Profile A: smaller trial | Profile B: larger beta |
| --- | --- | --- |
| Compute assumption | Approximately 2 vCPU / 8 GiB RAM | Approximately 4 vCPU / 16 GiB RAM |
| Services | Web, API, worker, PostgreSQL, Redis, reverse proxy in Compose | Same |
| Image strategy | GitHub Actions builds; private ECR stores immutable images | Same |
| Engineering assessment | Plausible for staging and a low-volume, deliberately serialized trial. Little margin for simultaneous database activity, API traffic, and concurrent analysis. | More credible as the first public beta profile; still requires load testing and memory/queue monitoring. |
| Primary risk | OOM/restarts, slow or delayed jobs, DB cache pressure when assessments overlap. Current worker concurrency is fixed at 5. | Still one host/AZ; bigger host does not prevent disk exhaustion, instance/AZ failure, destructive migration, or poor recovery. |
| Expected operating implication | Consider an initial operational rule of one assessment at a time. Reducing worker concurrency below 5 requires a code/configuration change unless already parameterized. | Can trial existing concurrency but must still gate simultaneous expensive assessments based on measured behavior. |
| Decision | Validate first in staging and stop if it fails the gates; do not infer that 8 GiB is production-safe. | Select only after Profile A measurements, workload requirements, and verified budget support it. |

### Proposed Profile A promotion gates

These are **provisional engineering gates**, not requirements verified by current load tests:

1. Run a representative staged workload including login/API calls, webhooks, one assessment with
   realistic repository size, database writes, and queue recovery after worker restart.
2. Run the agreed peak beta workload, including any intentionally permitted overlap. Until overlap
   is validated, limit assessment runs operationally to one at a time.
3. Observe CPU, host/container memory, swap/OOM events, PostgreSQL connections/latency, EBS free
   space/I/O, API response latency, queue depth/oldest job age, failed/stalled jobs, and completion
   time.
4. Promote only if the workload finishes without OOM or service restart, database and Redis remain
   healthy, and monitored headroom meets a target approved by the owner. A starting target is
   **at least 25% memory and disk headroom at observed peak**; refine after measurements.
5. If Profile A fails, stop or resize before public onboarding. Do not use customer data as a
   capacity test.

The profile comparison is about compute and memory only. Use the same reviewed, encrypted EBS
volume design in both profiles, sizing disk from measured database, image, log, and backup growth.
The readiness audit's 100–150 GiB EBS figure is a planning estimate, not a measured requirement.

## 2. Minimum Compose and host changes for a public beta

**Verified:** [`docker-compose.yml`](../docker-compose.yml) is the current Compose file. It defines
PostgreSQL, Redis, API, worker, web, OpenTelemetry Collector, Prometheus, and Grafana. It publishes
multiple service ports and includes development configuration/defaults. There is no production
Compose definition or AWS deployment manifest.

Create and review a separate production Compose configuration (for example,
`docker-compose.prod.yml`) and keep the local developer flow intact. Minimum controls:

1. **Use image references, not production builds.** Define API, web, and worker by immutable ECR
   digest or commit-SHA tag. Pull images built/tested by CI; never build on the live EC2 host.
2. **Remove public service port mappings.** Only the reverse proxy binds host TCP 80/443.
   PostgreSQL, Redis, API, web, Prometheus, Grafana, and OpenTelemetry ports remain on internal
   Docker networks. Do not rely on Security Groups alone to protect published ports.
3. **Use a maintained TLS reverse proxy.** Route normal web traffic and same-origin app proxy
   requests to Next.js; route only API-only webhook endpoints directly to API. Preserve raw request
   bodies and authentication/signature headers. Configure HTTPS redirect and certificate renewal.
4. **Set production mode and canonical origin.** Set `NODE_ENV=production`, HTTPS `APP_URL`, and
   correct web build-time `NEXT_PUBLIC_*` values. Web server-to-API calls need the Compose-internal
   `API_INTERNAL_URL`.
5. **Remove development credentials/defaults.** No development PostgreSQL password, default
   Grafana password, debug ports, or local provider callback URLs. Use unique credentials and
   secrets from a protected runtime source.
6. **Persist and protect state.** Mount PostgreSQL data to persistent encrypted EBS-backed
   storage. Decide Redis AOF/RDB settings and recovery expectations. Add filesystem free-space
   alarms and a tested cleanup policy for old images/logs.
7. **Configure restart, dependency, and stop behavior.** Use explicit health checks for PostgreSQL,
   Redis, API and web; `depends_on` is startup ordering, not runtime supervision. Use restart
   policies and stop grace periods long enough for in-flight work. Confirm worker handles
   SIGTERM and does not silently abandon active jobs.
8. **Add resource and log controls.** Set Docker log rotation and appropriate per-service CPU/memory
   reservations/limits only after testing. Avoid limits that cause unobserved OOM kills. Pin
   third-party image versions/digests; define patch/update ownership.
9. **Run migrations explicitly once.** Do not put Prisma migration commands in every app container
   startup. Use a controlled one-off migration step after backup, SQL review, and approval.
10. **Keep optional observability private or omit it initially.** Do not expose Grafana, Prometheus,
    or the collector publicly. If retaining them, restrict access, storage, retention, and
    credentials; verify additional memory/disk costs.
11. **Keep deployment config and secrets outside image layers/repository.** A production
    environment file, if temporarily used on-host, must be outside the checkout/build context with
    restrictive ownership and permissions. Do not print its contents or run environment dumps.
12. **Document recovery and ownership.** Name a person responsible for alerts, patching, backups,
    migration approval, and incident decisions before onboarding beta users.

Compose syntax and behavior must be tested in staging against the exact deployed Docker/Compose
versions. These changes are recommendations only; none were implemented for this planning task.

## 3. Production environment-variable inventory

There is no central runtime environment validation schema. The table below is derived from
[`.env.example`](../.env.example), Dockerfiles and runtime environment reads. “Required” means
required for the listed capability, not that every optional provider/payment/analytics feature must
be enabled for an MVP. Public values are configuration, not credentials. Secret values must never
use a `NEXT_PUBLIC_` name.

### Shared/core configuration

| Variable | Consumers | Required for beta? | Classification and handling |
| --- | --- | --- | --- |
| `NODE_ENV` | Web, API, worker | Yes: set to `production` | Non-secret runtime configuration. |
| `APP_URL` | API and web URL generation | Yes | Public canonical HTTPS origin; non-secret. Must match OAuth, cookie, CORS, and webhook setup. |
| `DATABASE_URL` | API, worker, migration job | Yes | **Secret** PostgreSQL connection string. Keep runtime-only; use least-privilege runtime credentials and a separate controlled migration credential if feasible. |
| `REDIS_URL` | API, worker | Yes | **Secret** if Redis has authentication; internal-only hostname and TLS/auth policy as configured. Never publicly expose Redis. |
| `API_INTERNAL_URL` | Web server | Yes | Non-secret internal URL (for example, Compose service name plus API port); not the public browser URL. |
| `PORT` / `API_PORT` | API | Yes for platform override or explicit port | Non-secret. API reads `PORT`, then `API_PORT`, then its default. Keep internal listener and proxy target consistent. |
| `BULLMQ_PREFIX` | API, worker | Optional | Non-secret namespace. If set, use the same value in both services; otherwise omit. |

### Web application

| Variable | Required? | Classification / deployment notes |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | Yes when browser UI calls the API through the configured public/base path | **Public build-time config**, embedded in the Next.js image. Set to the production same-origin API path/URL expected by the web client; do not expose API service credentials. |
| `NEXT_PUBLIC_SITE_URL` | Recommended | **Public build-time config**; set to canonical HTTPS origin. Existing site helper can fall back to `APP_URL`, but explicit consistency is preferable. |
| `NEXT_PUBLIC_GITHUB_APP_SLUG` | Required for GitHub App install links | Public GitHub App slug; build-time config. |
| `API_INTERNAL_URL` | Yes | Server-only non-secret service address for Next.js proxy routes. Configure at runtime and verify connectivity from the web container. |
| `CONTACT_WEBHOOK_URL` | Only if public contact submissions are forwarded | Server-only endpoint configuration; protect target allowlist/egress and use HTTPS. |
| `CONTACT_WEBHOOK_TOKEN` | Only when contact webhook is enabled | **Secret bearer token**, server-only. |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | No | Optional public analytics ID. Enable only with privacy/consent configuration approved. |
| `NEXT_PUBLIC_PROFESSIONAL_OFFER`, `NEXT_PUBLIC_ENTERPRISE_OFFER` | No | Optional public pricing-page copy; not secret. |

### API

| Variable(s) | Required? | Classification / deployment notes |
| --- | --- | --- |
| `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY_BASE64`, `GITHUB_WEBHOOK_SECRET` | Required for GitHub App, OAuth, installation access and signed webhook operation | ID values are identifiers; client secret, private key, and webhook secret are **secrets**. Configure GitHub App callback URL to `https://<domain>/api/auth/github/callback`; setup callback to `https://<domain>/api/github/installations/callback`; webhook route to the configured verified public endpoint. |
| `GITHUB_APP_CALLBACK_URL` | Required for GitHub user OAuth | Public callback URL configuration (not secret); must match GitHub OAuth settings exactly and use HTTPS. |
| `GITHUB_APP_BASE_URL` | Only for GitHub Enterprise Server or non-default API host | Non-secret provider base URL; default GitHub.com API if omitted. |
| `GITLAB_OAUTH_CLIENT_ID`, `GITLAB_OAUTH_CLIENT_SECRET`, `GITLAB_OAUTH_CALLBACK_URL` | Only if GitLab connection is enabled | Client secret is **secret**; ID and HTTPS callback are configuration. |
| `BITBUCKET_OAUTH_CLIENT_ID`, `BITBUCKET_OAUTH_CLIENT_SECRET`, `BITBUCKET_OAUTH_CALLBACK_URL` | Only if Bitbucket connection is enabled | Client secret is **secret**; ID and callback are configuration. |
| `AZURE_DEVOPS_OAUTH_CLIENT_ID`, `AZURE_DEVOPS_OAUTH_CLIENT_SECRET`, `AZURE_DEVOPS_TENANT_ID`, `AZURE_DEVOPS_OAUTH_CALLBACK_URL` | Only if Azure DevOps connection is enabled | Client secret is **secret**; tenant and callback are configuration. |
| `SOURCE_CONTROL_ENCRYPTION_KEY` | Required before storing non-GitHub source-control credentials | **Critical secret**; base64-encoded 32-byte key. Generate once, preserve in independent encrypted backup, and do not rotate without a token re-encryption plan. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PROFESSIONAL` | Only if enabling paid checkout/billing | First two are **secrets**; price ID is non-secret configuration. Keep secrets server-side and configure signed webhook routing. |
| `BILLING_ADMIN_USER_IDS` | Only if using server-provisioned billing administrators | Server-side list of user IDs; sensitive authorization configuration, not a secret credential. |
| `DATA_DELETION_OPERATOR_USER_IDS` | Only if enabling deletion approvals | Server-side authorization list; treat as restricted configuration. |
| `API_RATE_LIMIT_MAX`, `API_RATE_LIMIT_WINDOW_MS`, `API_REQUEST_MAX_BYTES` | Optional tuning; production limits should be explicitly reviewed | Non-secret security/availability settings. Current rate limiting is in-memory and therefore local to one API process. |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`, `OTEL_SERVICE_NAME`, `OTEL_SDK_DISABLED` | Optional telemetry | Non-secret endpoint/config. If endpoint requires authentication, credentials are not represented by this list and must be configured securely. |
| `PLAN_*`, `FREE_*`, `PROFESSIONAL_*`, `ENTERPRISE_*` | Optional product/business settings; defaults exist | Non-secret names, descriptions, limits, intervals and display values. Review production entitlement limits; do not mistake display prices for configured Stripe prices. |

### Worker and conditional capabilities

| Variable(s) | Required? | Classification / deployment notes |
| --- | --- | --- |
| `DATABASE_URL`, `REDIS_URL`, `BULLMQ_PREFIX` | Database and Redis required; prefix optional | Same environment consistency as API. |
| `SESSION_RETENTION_DAYS`, `WEBHOOK_RETENTION_DAYS` | Optional; defaults are in code | Non-secret positive-integer retention settings. Confirm data-retention policy before overriding. |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY_BASE64` (or supported legacy `GITHUB_APP_PRIVATE_KEY`) | Required for GitHub App operations performed by worker | App identifier and **secret private key**. Worker does not need the OAuth client secret or webhook secret unless a separately verified code path requires them. |
| `GITLAB_OAUTH_CLIENT_ID`, `GITLAB_OAUTH_CLIENT_SECRET` | Only if GitLab token refresh/provider operations are used | Secret is server-only. |
| `BITBUCKET_OAUTH_CLIENT_ID`, `BITBUCKET_OAUTH_CLIENT_SECRET` | Only if Bitbucket operations are used | Secret is server-only. |
| `AZURE_DEVOPS_OAUTH_CLIENT_ID`, `AZURE_DEVOPS_OAUTH_CLIENT_SECRET`, `AZURE_DEVOPS_TENANT_ID` | Only if Azure DevOps operations are used | Client secret is server-only. |
| `AI_CODE_REVIEW_ENABLED`, `AZURE_OPENAI_BASE_URL`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_MODEL` | Only if Azure AI code review is enabled | Base URL/model are configuration; API key is **secret**. Disable explicitly unless the provider, spend controls, data handling, and feature behavior are approved. |
| `DASHBOARD_BASE_URL` | Optional link generation in worker notifications/results | Public HTTPS origin; non-secret configuration. |
| `RESEND_API_KEY`, `EMAIL_FROM` | Only if outbound notification email is enabled | API key is **secret**; sender is public configuration that must be verified with the email provider. If omitted, notification behavior remains in-app as documented. |

### Build-time versus runtime handling

The web Dockerfile accepts `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_GITHUB_APP_SLUG`, and
`NEXT_PUBLIC_SITE_URL` as build arguments; these values can be embedded in the client image and
must be correct when the image is built. They are not secrets. Never pass runtime secrets as
Docker build arguments or bake them into an image. Runtime service credentials belong in the
approved secret source, read by the EC2 instance role, then injected only into the intended
container. Keep CI PR jobs free of production credentials.

**Minimum for a GitHub-only beta:** `NODE_ENV`, `APP_URL`, `DATABASE_URL`, `REDIS_URL`,
`API_INTERNAL_URL`, public web URL/API/App slug build settings, GitHub App ID/client ID/client
secret/private key/webhook secret and callback URL; `PORT`/`API_PORT` as needed. Other source
control providers, billing, email, contact forwarding, analytics, and AI code review are
conditional; omit their secrets until each capability is approved.

## 4. GitHub Actions workflows and IAM permissions

### Workflow separation

1. **CI validation** — retain the current PR/push workflow for tests, typecheck, lint, build, Prisma
   generation, and migrations against disposable CI PostgreSQL only. Pin dependencies with a
   frozen lockfile in the implementation. PR jobs must not have AWS credentials, production
   secrets, or production deployment permissions.
2. **Image build and publish** — after merge to the protected release branch, use GitHub OIDC to
   assume a dedicated ECR publisher role. Build web/API/worker from existing Dockerfiles, label and
   tag with commit SHA, publish to three approved repositories, record immutable digests and
   provenance. Never use `latest` as the only reference.
3. **Staging/production deployment** — use protected GitHub Environments, with human approval for
   production. The deploy job assumes a separate deployment role and calls SSM Run Command for one
   designated instance. It should request a fixed, reviewed deployment document/script rather than
   arbitrary root shell text. Check command status and application health; fail closed on timeout.
4. **Migration job** — explicit, separately gated one-off production operation. Require reviewed
   migration SQL, verified backup, approval, and target identity check. Do not run migrations on
   every app startup or automatically roll back destructive schema changes.

Use `permissions: id-token: write` and only the minimum GitHub token permissions (`contents: read`,
plus any specifically justified attestation permission). Restrict AWS trust to the exact GitHub
organization/repository, intended branch or protected environment subject, and
`aud=sts.amazonaws.com`. Use distinct OIDC roles for publishing and production deployment if
possible.

### IAM role matrix

| Principal | Minimum intended AWS permissions | Restrictions |
| --- | --- | --- |
| GitHub OIDC ECR publisher role | `ecr:GetAuthorizationToken` on `*`; `ecr:BatchCheckLayerAvailability`, `ecr:InitiateLayerUpload`, `ecr:UploadLayerPart`, `ecr:CompleteLayerUpload`, `ecr:PutImage` on only the three named ECR repository ARNs. Add read actions only if the build process actually needs them. | Trust only the exact repo and protected release branch/environment. No EC2, SSM, secrets, S3, IAM, or account-admin access. Pre-create repositories; do not allow workflow to change repository policy. |
| GitHub OIDC deploy role | `ssm:SendCommand` for the approved SSM document and the designated EC2 instance; `ssm:GetCommandInvocation` / limited command-status read to observe the invocation. Add `ec2:DescribeInstances` only if resolving the instance by tag is required. | Trust only the protected production Environment subject. No broad `ssm:*`, `StartSession`, ECR write, secret read, or arbitrary target selection. Use a fixed command document and instance/tag condition to limit command scope. |
| EC2 instance profile | SSM managed-node messaging/registration permissions needed by the installed SSM Agent; `ecr:GetAuthorizationToken` on `*`; `ecr:BatchGetImage`, `ecr:GetDownloadUrlForLayer`, `ecr:BatchCheckLayerAvailability` on approved ECR repository ARNs; secret read actions described below; `s3:PutObject` to the backup prefix for scheduled backups. | Do not grant ECR push/delete, broad S3 access, or account administration. For restore, grant `s3:GetObject` and KMS decrypt only through a separately controlled break-glass role or temporary approved policy, rather than permanent app credentials. |
| Runtime secret reader (preferably EC2 instance profile) | Either `ssm:GetParameter`/`ssm:GetParameters` on exact encrypted parameter ARNs, or `secretsmanager:GetSecretValue` on exact secret ARNs. Add `kms:Decrypt` scoped to the customer-managed KMS key only when required by that secret service/key policy. | Do not grant `Get*` over all paths/secrets. Do not expose the AWS role to containers beyond what host retrieval requires; do not log secret response values. |
| Backup/restore operator | Backup writing can use instance role `s3:PutObject` to a specific bucket/prefix; SSE-KMS may also require `kms:GenerateDataKey` under the selected key policy. Restore operator gets narrowly scoped `s3:ListBucket` prefix, `s3:GetObject`, and `kms:Decrypt`. | Separate routine write-only backup from restore/deletion authority. S3 delete/version deletion and retention changes should be separately controlled. |

The SSM instance-role action set depends on the SSM Agent version and chosen subnet/network path.
Use AWS's supported managed core policy as a baseline only after reviewing its current actions and
scope; do not assume a policy name is least privilege. If using private subnets, endpoint resources
and their costs/permissions need separate review. **All IAM changes and exact ARN/condition syntax
require AWS account review before deployment.**

## 5. Production backup and restoration procedure

### Recommended initial backup policy

1. **PostgreSQL logical backup:** run `pg_dump` against the production PostgreSQL service using a
   dedicated read-capable backup identity. Prefer PostgreSQL custom format (`pg_dump -Fc`) for
   restore flexibility and compression; the current
   [`scripts/db-backup.mjs`](../scripts/db-backup.mjs) writes plaintext SQL under local
   `./backups/` and is not by itself an approved production pipeline.
2. **Consistency and identity:** capture a UTC timestamp, database/schema identity, application
   release SHA, migration status, dump size, command exit status, and checksum. Never include a
   connection URL/password in command output or backup metadata. Alert if any scheduled backup is
   missing or fails.
3. **Encryption in transit and at rest:** use TLS to S3 where supported; block public access; use
   server-side encryption (SSE-S3 or SSE-KMS after price/key-policy review). Encrypt the EBS
   database volume. If client-side encryption is selected, document key escrow and verify restore
   from a separately controlled key copy. Protect `SOURCE_CONTROL_ENCRYPTION_KEY` independently
   from the database dump.
4. **S3 boundary:** dedicated private bucket or tightly scoped prefix, bucket-owner-enforced
   ownership, least-privilege access, versioning if approved, lifecycle rules, and no public ACLs.
   Do not store the only backup on the EC2/EBS host. Restrict backup role to object creation in its
   designated prefix; separate restore and deletion authorities.
5. **Cadence and retention:** propose at least one daily backup and a retention schedule such as
   7 daily, 4 weekly, and 3 monthly copies. These are a starting proposal, not a repository
   requirement: owner must set RPO/RTO and approve retention, lifecycle, S3 versioning, KMS key
   retention, and associated costs. Run an on-demand pre-migration backup as well.
6. **Verification:** after upload, verify object existence, non-zero size and checksum; periodically
   download/decrypt a backup to an isolated test host and perform a full restore. A successful
   `pg_dump` command alone does not prove recoverability.

### Redis and BullMQ recovery

Redis contains BullMQ queue state, including pending/delayed/retry information. The repository has
a Redis volume but no documented production persistence/restore schedule. Before beta:

- Decide whether to persist Redis using a tested RDB and/or AOF configuration on persistent EBS.
  Confirm the durability/performance tradeoff and persistence behavior with the chosen Redis image.
- Monitor memory, persistence errors, key eviction, queue age, failed jobs, and Redis health.
  Configure memory/eviction so BullMQ keys cannot be silently evicted under normal job load.
- Do not assume a PostgreSQL restore and Redis backup represent the same point in time. Treat queue
  state as recoverable only if durable source records and a tested, idempotent re-enqueue procedure
  exist. Otherwise back up Redis data and document the consistency limitation.
- Test a worker restart separately from Redis-loss recovery. Do not routinely flush queues or
  delete Redis volumes.
- The operations runbook reports that worker health, stalled-job/queue-depth metrics, and a
  reconciliation workflow are not yet exposed/configured. Close those gaps before beta or impose
  documented manual operating limits.

### Restore procedure (staging first)

1. Declare incident/change owner; stop incoming writes/traffic and pause API/worker processing as
   appropriate. Preserve current EBS volumes and logs; do not overwrite the only database copy.
2. Select a verified backup object and approved recovery point; record expected data-loss interval.
   Confirm environment/region, S3 bucket/key, KMS availability, and exact target identity.
3. Restore the dump to a new isolated PostgreSQL data volume/instance, not over the original
   production data. Verify checksum and decrypt permissions before `pg_restore`.
4. Restore or initialize Redis according to the recovery decision. If Redis is reconstructed,
   run only the approved idempotent reconciliation/requeue process; do not guess at job payloads.
5. Apply/verify the intended Prisma migration state only after comparing backup migration history
   and application release compatibility. Do not apply unreviewed migrations as part of restore.
6. Start API/web/worker in a restricted validation environment. Check DB and Redis health,
   readiness, tenant/org counts, key audit records, critical workflows, and worker queue behavior.
7. Record elapsed recovery time, data-loss estimate, validation results, and any manual repair.
   Obtain explicit approval before switching traffic or attaching restored volumes to production.
8. Keep the original data and backup intact until recovery is accepted; then follow approved
   retention/deletion policy.

The first public beta must complete at least one full restore drill before real customer data is
accepted. Agree RPO/RTO and backup owner before that drill.

## 6. Health checks and operational metrics

### Existing verified checks

- API `GET /health` is a liveness response.
- API `GET /health/ready` checks PostgreSQL and Redis and returns 503 if either fails.
- The readiness endpoint does not establish worker health.
- Worker has SIGTERM/SIGINT shutdown handling but no HTTP health endpoint.
- Worker concurrency is hard-coded to five.
- The operations runbook says queue-depth, stalled-job, and worker-health metrics are not currently
  exposed/configured.

### Required before public beta

| Signal/check | Minimum action |
| --- | --- |
| Container liveness | Add Compose health checks for web and API using an endpoint that does not expose sensitive details. Keep DB/Redis native `pg_isready`/`redis-cli ping` checks private. |
| Worker health | Add a worker heartbeat/health signal that proves the process is alive and connected to Redis, not just that the container exists. Alert when heartbeat becomes stale. |
| Queue health | Export or report waiting, active, delayed, failed, stalled counts and oldest waiting-job age. Alert on growing backlog, stalled jobs, repeated failures, and scheduler jobs not advancing. Avoid exposing queue data publicly. |
| Assessment pressure | Track active assessments, job duration, retry count and completion/failure rate. Add a controlled concurrency/queue admission mechanism before allowing simultaneous workloads on Profile A. |
| Memory/CPU | Monitor EC2 CPU plus host and per-container memory; host memory requires a supported agent/custom metric. Alert on sustained pressure and OOM/restart events. Include Redis memory and PostgreSQL process memory. |
| Disk/storage | Monitor EBS free bytes/percentage, PostgreSQL data/WAL growth, Docker image/log growth and backup space. Alert well before disk exhaustion; verify log rotation and image cleanup. |
| Database | Monitor `/health/ready`, PostgreSQL connection count, query latency, lock/wait errors, storage/WAL growth, and failed backups. Readiness alone is not a database performance monitor. |
| Redis | Monitor ping, memory, evictions, persistence health, reconnects and queue key growth. |
| External availability | Check HTTPS/TLS certificate expiration, public web route, API readiness, and GitHub webhook delivery errors without sending destructive requests. |
| Notifications | Route alarms to a monitored owner/contact. Current local Prometheus setup has no configured notification/paging delivery; do not treat dashboards without alert delivery as monitoring. |

Use bounded retention and avoid logging credentials, webhook payloads, source diffs, tokens, or
personal data. Verify current AWS monitoring/metric ingestion costs in the calculator/account.

## 7. AWS resource inventory and cost inputs

This is a planning inventory, not a price quote. Every cost and credit eligibility item must be
checked in the **AWS Pricing Calculator for the chosen region** and the **actual AWS billing/credits
console**. Credit coverage, expiry, eligible services, quotas, and post-credit charges are
unresolved.

| Resource | Why needed | Essential for first beta? | Cost category | Information needed to price |
| --- | --- | --- | --- | --- |
| EC2 instance | Runs Docker Compose services | Yes | Compute hours; instance size/OS; possible data transfer | Region, selected family/size, OS, runtime hours, purchase option, credit eligibility and actual launch schedule. |
| EBS root/data volume | OS, images, PostgreSQL/Redis persistence | Yes | Provisioned GB-month, performance, snapshots, KMS if customer-managed key | Volume type/size, performance, AZ, snapshot frequency/retention, encryption-key type. |
| Public IPv4/stable address | Public HTTPS origin and DNS | Yes for direct single-host ingress | Address hours and possible network transfer | Whether address is needed/allocated/idle; region and current public IPv4 terms. |
| VPC, subnet, route tables, Internet Gateway, Security Group | Network boundary and Internet routing | Yes | Often no direct charge for core constructs; related public IP, transfer, logging/endpoints may cost | Chosen topology, traffic, endpoints, flow logs and account-specific billing terms. |
| Domain and DNS | Stable OAuth/webhook hostname | Yes; domain registration can be external | Domain registration/renewal, hosted zone and query charges | Registrar, DNS provider, domain renewal and query estimates. |
| Reverse proxy/TLS | HTTPS and routing on one host | Yes | Proxy software may be no-cost; EC2/network/monitoring costs remain | TLS automation, domain, egress; no separate AWS LB is planned. |
| Private ECR repositories | Store versioned web/API/worker images | Yes for chosen build strategy | Image storage and data transfer | Image size/count, retention/lifecycle, region, pull traffic and credit eligibility. |
| GitHub Actions | Build/test/publish/deploy | Yes | GitHub plan/runner minutes and artifact/cache use; not necessarily AWS charge | Organization plan, runner type/architecture, workflow frequency, cache/artifact retention. |
| S3 backup bucket | Off-host database/Redis backups | Yes | Storage, requests, retrieval, lifecycle, transfer, encryption | Dump size/compression, cadence, retention, versioning, restore frequency/size, region, SSE-KMS choice. |
| IAM roles / GitHub OIDC provider | Temporary CI auth and least-privilege instance identity | Yes | Usually no per-role charge; related services may cost | Account policies/quotas, trust constraints, key-management choice. Confirm account restrictions. |
| Systems Manager | Instance administration and GitHub-triggered deploy commands | Yes for no-public-SSH plan | Some SSM capabilities/endpoints may incur charges | Session/command use, agent/network design, interface endpoint decision, region and current terms. |
| Runtime secret store | Safe delivery of DB/provider credentials | Yes, exact mechanism unresolved | Parameter Store/KMS or Secrets Manager charges may apply | Number/size of secrets, retrieval rate, KMS key type, rotation, region, free/credit eligibility. |
| CloudWatch logs/alarms/metrics | Logs and actionable operational alerts | Minimum alerts/logging: yes; chosen AWS service: decision | Ingestion, storage, custom metrics, dashboards, alarms | Log GB/day, retention, metric/alarm count, agent/custom metrics, region. |
| S3/KMS backup encryption key | Encrypt backups and control decrypt | Encryption: yes; customer-managed KMS optional | KMS key/month and request categories may apply | SSE-S3 vs SSE-KMS/client encryption, key count, request volume, key policy and key recovery. |
| EBS snapshots/AWS Backup | Additional storage recovery point | Optional but recommended if budget supports | Snapshot stored GB-month, backup service/features | Change rate, retention, schedule, regions, restore frequency, selected service coverage. |
| CloudTrail | Audit relevant AWS management activity | Account baseline should be inspected; advanced/data event logging optional | Management/data event and storage costs may apply | Existing trail, event types, retention/destination, account/org coverage. |
| NAT Gateway | Private subnet outbound access | No for initial public-subnet host; avoid unless needed | Hourly and data-processing charges | Whether private subnets/endpoints are selected and outbound volume. |
| ALB/NLB, WAF, RDS, ElastiCache, multi-AZ services | Later HA/scaling/security options | No for minimum one-host beta | Service hours, capacity, requests/data processing | Required availability, throughput, region, data size, request volume, support and credits. |

Do not treat a budget alert as a hard cap. Set notifications, review actual billed usage frequently,
and stop/resize nonessential resources if account spend approaches the approved limit.

## 8. Staged implementation order

This order tests the smaller profile before committing to the larger one and avoids production
database changes before infrastructure/recovery readiness:

1. **Owner decisions:** approve one-host/AZ risk, region, beta users/workload, domain, RPO/RTO,
   secret ownership, and a spending stop threshold. Confirm $100 credit amount, expiry, eligible
   services and region in the AWS account; model both profiles in the Pricing Calculator.
2. **Repository implementation backlog:** create a production Compose definition; remove public
   app/data/observability ports; add TLS proxy, health checks, secret injection, log rotation,
   persistent paths and explicit migration operation. Resolve worker concurrency/health/backlog
   visibility. Do not alter local developer Compose behavior.
3. **CI and IAM design:** split PR validation, image publishing and deployment. Pin images by SHA
   digest. Configure exact OIDC trust claims and narrow publisher/deployer/instance roles. Review
   commands so GitHub can deploy only to the designated instance through a fixed SSM document.
4. **Staging Profile A:** provision the smaller test profile only after budget approval. Use fake or
   sanitized provider credentials/data; no customer DB. Deploy the CI-built ECR images and
   production-like Compose configuration.
5. **Validate operations and recovery:** test GitHub/provider callbacks, invalid/valid webhook
   signatures, restart behavior, queue retries, worker loss, disk/log rotation, scheduled backup,
   S3 upload, and full isolated PostgreSQL restore. Decide/test Redis restore/reconciliation.
6. **Load test Profile A:** measure agreed workload and all signals in Section 6. Keep assessment
   concurrency within tested bounds. Do not expose public beta until gates pass.
7. **Resize decision:** if gates fail or required workloads exceed demonstrated capacity, stop
   staging services and price/review Profile B in the account. Resize or provision Profile B only
   after explicit budget approval. Retest from clean deployment and repeat operational checks.
8. **Production preparation (no migration yet):** provision production network/host, secret paths,
   encrypted EBS, DNS/TLS, monitoring, S3 policy, ECR access, and deployment controls. Validate
   access and backup destination; keep public app traffic restricted.
9. **Database migration gate:** review every pending migration, verify the exact target, take and
   verify pre-migration backup, confirm restore drill and backward compatibility, then obtain
   human approval. Only then execute one explicit `prisma migrate deploy` operation. No database
   production migration is authorized by this plan.
10. **Controlled beta opening:** deploy pinned images, run health and OAuth/webhook smoke checks,
    monitor alerts and spend closely, onboard a small agreed cohort, and review capacity/backup
    health daily during the initial period.

## 9. Rollback and recovery decision rules

- For an app-only failure with a compatible schema, redeploy the last known-good image digests and
  release configuration; verify API, readiness, web, worker, and queue recovery.
- Do not roll back an application image blindly after schema changes. Migrations do not have
  automatic Prisma down migrations; a destructive change may require forward fix or database
  restore.
- For data corruption, stop writes, preserve current volumes/logs, restore a verified backup into
  isolated storage, validate tenant/audit/application integrity, and approve cutover explicitly.
- For Redis loss, preserve available Redis files/logs first; restore if the tested policy supports
  it. Otherwise use the approved idempotent DB-backed reconciliation procedure. Do not flush or
  manually recreate jobs ad hoc.
- Never delete the only EBS/database copy or S3 backup during rollback. A container rollback is
  not a database rollback.
- Record actual RPO/RTO in a restore exercise; do not claim either until measured.

## 10. Unresolved decisions and blockers

1. **Cost:** actual AWS account, region, credit expiry/eligibility and current calculator quote are
   unknown. No conclusion that $100 covers either profile is possible.
2. **Profile selection:** Profile A has not been load-tested; Profile B has not been priced or
   load-tested.
3. **Worker control:** current concurrency is 5 in code. Decide whether to add a configuration
   setting/limiter before Profile A testing and determine safe assessment concurrency.
4. **Backup policy:** agree daily cadence, retention, encryption key strategy, RPO/RTO, Redis
   durability/reconciliation, and restore owner.
5. **Secrets:** select SSM Parameter Store/Secrets Manager or a reviewed alternative, determine
   which services receive each secret, and establish key backup/rotation procedure.
6. **Monitoring:** worker heartbeat, queue/backlog/stalled metrics, alert receiver, memory/disk
   telemetry and log retention are not complete or verified in the repository.
7. **Production domain and integrations:** domain/DNS, GitHub App ownership/settings and enabled
   third-party providers/billing/email/AI services are not verified.
8. **Tenant/data risk:** the audit found no PostgreSQL RLS policies in checked-in migrations.
   Application authorization and tenant isolation must be reviewed/tested as the effective
   isolation boundary; do not assume database RLS.
9. **Deployment workflow:** repository has CI validation but no AWS image publish/deployment
   workflow. OIDC trust, roles, SSM document, ECR repositories and release gates remain to be
   implemented and reviewed.

The intended next step after approving this plan is a separately scoped implementation phase. No
AWS infrastructure should be created and no production migration should run until the cost, account,
security, backup/restore, and profile gates above are resolved.
