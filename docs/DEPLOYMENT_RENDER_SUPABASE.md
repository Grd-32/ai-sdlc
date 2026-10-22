# Render and Supabase deployment preparation

This document describes a first hosted deployment of the existing pnpm monorepo. It is
preparation only: it does not create provider resources, deploy the application, or change the
database schema.

## Architecture discovered

The repository root is the pnpm workspace root (`pnpm-workspace.yaml`), with one
`pnpm-lock.yaml` and `packageManager: pnpm@9.15.0`.

| Workspace     | Runtime                 | Responsibilities                                                                               |
| ------------- | ----------------------- | ---------------------------------------------------------------------------------------------- |
| `apps/web`    | Next.js 15.1 / React 19 | Public site, dashboard, same-origin auth/API proxy                                             |
| `apps/api`    | Hono on Node.js         | REST API, OAuth callbacks, webhooks, database and queue producer                               |
| `apps/worker` | Node.js BullMQ worker   | GitHub/source-control analysis, assessments, notifications, retention and scheduled queue jobs |

Shared workspace packages: `billing`, `db`, `github`, `policy`, `provenance`, `risk`,
`security`, and `source-control`.

The database package uses Prisma Client and Prisma CLI **6.19.3**, PostgreSQL, and 28 checked-in
migrations. `DATABASE_URL` is the only datasource URL in `schema.prisma`; there is no
`DIRECT_URL` or shadow-database setting. The migrations use standard PostgreSQL types, tables,
indexes, constraints, and PL/pgSQL triggers; no extension installation was found. Some historical
migrations drop legacy policy-rule columns, so treat migration history and backups as important
when connecting any database that is not empty.

Root scripts include `build`, `lint`, `typecheck`, and `test`; `db:generate`, `db:migrate`
(development-only `prisma migrate dev`), and `db:push` are also present. For a deployed database,
use `prisma migrate deploy`, not `migrate dev` or `db push`. CI uses Node 22; the Dockerfiles use
Node 20; the root engine range is Node `>=20`.

The repository has Dockerfiles for all three applications and a local Compose stack with
PostgreSQL, Redis, API, worker, web, and optional Prometheus/Grafana/OpenTelemetry services.
Observability containers are not required for the app. The web app uses Next standalone output.
No application file uploads or durable local-file storage were found; user data, provider
credentials, sessions, reports, and job records are stored in PostgreSQL/Redis. Browser
`localStorage` is only used for interface preferences and analytics consent.

### Existing operational behavior

- API health endpoints: `GET /health` (liveness) and `GET /health/ready` (PostgreSQL **and**
  Redis readiness). Use `/health/ready` for the API service health check.
- The API queues work in BullMQ; the separate worker is required to process it. The worker also
  installs daily retention, risk-acceptance-expiry, and finding-SLA jobs in Redis.
- GitHub, GitLab, Bitbucket, Azure DevOps, and optional Stripe deliveries enter API webhook
  routes. The GitHub endpoint verifies HMAC signatures; the other source-control adapters verify
  provider/connection-specific secrets or authorization. Webhooks enqueue work; they do not replace
  the worker.
- Browser auth callbacks use Next same-origin routes under `/api/auth/...`, which proxy to the API
  using `API_INTERNAL_URL`. Provider OAuth callback registrations should therefore use the **web
  service URL**, not the API host. The web app also proxies GitHub, Bitbucket, and Azure DevOps
  webhooks; GitLab and Stripe webhook routes exist only on the API.
- The API sets secure cookies when `NODE_ENV=production` or `APP_URL` is HTTPS. CORS allows the
  exact `APP_URL` origin with credentials. Set `APP_URL` to the public web origin.
- Request logs are JSON and include method, path, status, timings, and request/correlation IDs;
  request bodies are not logged by that middleware. The in-memory rate limiter is per process and
  is not a cross-instance abuse-control mechanism.
- Worker logs include queue/job and record identifiers plus error messages; restrict log access
  and retention as sensitive operational data, and do not export them without review.
- `/health/queue-test` is disabled when `NODE_ENV=production`.
- Tenant authorization is enforced by application authorization/scoping logic and has isolation
  tests. The inspected migrations do not enable PostgreSQL row-level security; do not treat
  Supabase RLS as an additional tenant boundary.

## Free-tier feasibility

The web app and API can each be represented as a Render web service, but the complete application
is **not a reliable $0/month Render deployment as currently architected**:

1. The queue worker is a long-running background process. It must remain connected to Redis to
   consume jobs and maintain daily scheduled jobs. It is not a Render web service, and a free web
   instance that sleeps cannot provide dependable worker availability. Render's background-worker
   service is the appropriate service type; confirm its current price before provisioning.
2. API/web free instances can sleep and have cold starts and ephemeral filesystems. This is suitable
   for a low-traffic experiment, not dependable webhook or continuous-monitoring service.
3. The application still requires a Redis-compatible TCP service for BullMQ. Supabase supplies the
   PostgreSQL database, not this queue. A REST-only Redis endpoint is not a replacement for the
   ioredis/BullMQ connection.
4. Supabase Free may pause inactive projects and has finite database/storage/compute limits. Check
   the current Supabase plan terms before relying on it for an always-available MVP.

Consequently, no `render.yaml` is supplied: a Blueprint that presents this as a complete zero-cost
deployment would obscure the worker and Redis requirements. The exact service commands below are
valid for the current workspace, but the worker service and Redis must be funded/provided by a
compatible plan, or the deployment architecture must be deliberately changed after approval.

## Render service configuration

Set each service's **Root Directory** to the repository root (`.`). Use Node 22 (the CI runtime;
the code supports Node 20+), and keep pnpm at the repository-pinned 9.15.0 via Corepack.

Use this Build Command for each service:

```sh
corepack enable && corepack prepare pnpm@9.15.0 --activate && pnpm install --frozen-lockfile && pnpm db:generate && pnpm build
```

The workspace install uses the single lockfile. Prisma Client must be generated before TypeScript
builds; the root `build` script builds the shared packages and applications in dependency order.
Prisma generation and compilation do not require a live database. The production build does not
apply migrations.

| Render service | Service type      | Start Command                         | Notes                                                                                                                      |
| -------------- | ----------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Web            | Web Service       | `pnpm --filter @ai-sdlc/web start`    | Next.js reads Render's `PORT`; browser-facing API URL must be set at build and runtime.                                    |
| API            | Web Service       | `pnpm --filter @ai-sdlc/api start`    | Binds Render's `PORT` (the API now prefers `PORT`, retaining `API_PORT` for local Compose). Health check: `/health/ready`. |
| Worker         | Background Worker | `pnpm --filter @ai-sdlc/worker start` | No HTTP listener or health-check path; requires `REDIS_URL` and `DATABASE_URL`.                                            |

The web service's `API_INTERNAL_URL` should point to the API's reachable HTTPS URL unless private
service networking has been separately confirmed for the selected Render plan. `NEXT_PUBLIC_API_URL`
also points to the API's public URL for browser-facing links. These values are distinct from
`APP_URL`, which is the web origin.

## Supabase database setup and migrations

1. Create a new PostgreSQL project and use a database role with schema-creation and migration
   privileges. Keep its credentials private.
2. In Supabase **Connect**, select a connection method reachable from Render. The Prisma schema
   currently accepts only `DATABASE_URL`. Prefer the session-mode pooler URL for the persistent
   API/worker runtime if the direct database host is not reachable over the deployment network.
   Avoid a transaction-mode pooler for migrations unless its Prisma compatibility is deliberately
   configured and tested.
3. If runtime connection pooling and a distinct migration connection are desired, store the
   direct/session migration URL separately as `MIGRATION_DATABASE_URL` and pass it to Prisma only
   for the migration command below. No schema change is needed: Prisma receives it as
   `DATABASE_URL` for that one process. Do not expose either URL to the browser.
4. Set small Prisma connection pools in the Supabase URL if required by the project's connection
   limit. Account for independent Prisma pools in the API and worker; confirm actual capacity and
   connection counts before increasing replicas.
5. Take a backup/snapshot before migrating any non-empty database. Confirm the target project's
   migration history before applying the checked-in migrations. Never point an initial migration
   command at a database containing data that must be preserved without reviewing the SQL first.
6. Apply pending migrations once, from a controlled release/maintenance step, before serving new
   application code:

   ```sh
   DATABASE_URL="$MIGRATION_DATABASE_URL" pnpm --filter @ai-sdlc/db exec prisma migrate deploy
   ```

   If no separate migration URL is configured, set `DATABASE_URL` to the selected Supabase
   connection URL for this command. `migrate deploy` applies pending migrations; it does not
   generate a Prisma client or create a shadow database. Do not run `migrate dev` against
   production.

## Environment-variable checklist

Configure secrets in the Render service's secret/environment settings. Never put secrets in
`NEXT_PUBLIC_*`, the repository, Blueprint values, build logs, or browser code. Give each service
only the values it uses; API and worker need the database, Redis, and provider credentials.

### Required for the core hosted application

| Variable                                                    | Purpose / scope                                                                                                                                         | Configure                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `NODE_ENV=production`                                       | Enables production cookie behavior and disables the queue-test endpoint. Server-only.                                                                   | Web, API, worker.                                              |
| `APP_URL`                                                   | Canonical HTTPS **web** origin; CORS allow-origin, OAuth origin, and redirect destination. Server-only.                                                 | API, worker if it sends links; also web if used by its routes. |
| `DATABASE_URL`                                              | PostgreSQL connection for Prisma. Server-only secret.                                                                                                   | API and worker; migration command environment.                 |
| `REDIS_URL`                                                 | Redis-compatible TCP connection for BullMQ. Server-only secret.                                                                                         | API and worker.                                                |
| `API_INTERNAL_URL`                                          | Reachable API base URL used by server-side Next proxy calls. Server-only.                                                                               | Web.                                                           |
| `NEXT_PUBLIC_API_URL`                                       | Browser-visible API base URL used for browser-facing redirects/links. Public, not secret. Set at build and runtime.                                     | Web.                                                           |
| `NEXT_PUBLIC_SITE_URL`                                      | Public canonical web origin for site metadata. Public.                                                                                                  | Web; may fall back to `APP_URL`.                               |
| `NEXT_PUBLIC_GITHUB_APP_SLUG`                               | GitHub App slug used by the repository-install UI. Public.                                                                                              | Web; rebuild after changing.                                   |
| `GITHUB_APP_ID`                                             | GitHub App JWT/installation identity. Server-only.                                                                                                      | API, worker.                                                   |
| `GITHUB_APP_CLIENT_ID`                                      | GitHub App user OAuth client ID. Server-only config.                                                                                                    | API.                                                           |
| `GITHUB_APP_CLIENT_SECRET`                                  | GitHub App OAuth client secret. Secret.                                                                                                                 | API.                                                           |
| `GITHUB_APP_PRIVATE_KEY_BASE64` or `GITHUB_APP_PRIVATE_KEY` | GitHub App private key used for installation tokens. Secret; base64 is preferred, the legacy alternative accepts an escaped PEM. Set one.               | API, worker.                                                   |
| `GITHUB_APP_CALLBACK_URL`                                   | OAuth callback URL registered in the GitHub App: `https://<web-host>/api/auth/github/callback`.                                                         | API.                                                           |
| `GITHUB_WEBHOOK_SECRET`                                     | HMAC signing secret configured on the GitHub App webhook. Secret.                                                                                       | API.                                                           |
| `SOURCE_CONTROL_ENCRYPTION_KEY`                             | Base64-encoded 32-byte key for provider tokens/webhook secrets encrypted in PostgreSQL. Secret; changing it makes existing encrypted values unreadable. | API, worker.                                                   |

`GITHUB_APP_BASE_URL` is optional and defaults to `https://api.github.com`; configure it only for
GitHub Enterprise Server. `API_PORT` is the local fallback; Render provides `PORT`.

### Optional or feature-specific

| Variables                                                                                                                                                                                                                                                                                                 | Purpose / when needed                                                                                                                                                               | Scope                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `GITLAB_OAUTH_CLIENT_ID`, `GITLAB_OAUTH_CLIENT_SECRET`, `GITLAB_OAUTH_CALLBACK_URL`                                                                                                                                                                                                                       | GitLab connection; register `https://<web-host>/api/auth/gitlab/callback`. Callback URL defaults from `APP_URL`.                                                                    | API, worker for client credentials; callback config API. |
| `BITBUCKET_OAUTH_CLIENT_ID`, `BITBUCKET_OAUTH_CLIENT_SECRET`, `BITBUCKET_OAUTH_CALLBACK_URL`                                                                                                                                                                                                              | Bitbucket connection; register `https://<web-host>/api/auth/bitbucket/callback`.                                                                                                    | API, worker as used; callback config API.                |
| `AZURE_DEVOPS_OAUTH_CLIENT_ID`, `AZURE_DEVOPS_OAUTH_CLIENT_SECRET`, `AZURE_DEVOPS_TENANT_ID`, `AZURE_DEVOPS_OAUTH_CALLBACK_URL`                                                                                                                                                                           | Azure DevOps connection; tenant defaults to `organizations`; register `https://<web-host>/api/auth/azure-devops/callback`.                                                          | API, worker as used.                                     |
| `AI_CODE_REVIEW_ENABLED`, `AZURE_OPENAI_BASE_URL`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_MODEL`                                                                                                                                                                                                           | Optional Azure AI Foundry code review. Only enable when the HTTPS endpoint and deployment are configured; key is secret.                                                            | Worker; never `NEXT_PUBLIC_*`.                           |
| `RESEND_API_KEY`, `EMAIL_FROM`                                                                                                                                                                                                                                                                            | Optional transactional email. Without these, notifications remain in-app. Key is secret; sender/domain must be verified.                                                            | Worker.                                                  |
| `DASHBOARD_BASE_URL`                                                                                                                                                                                                                                                                                      | Optional dashboard links in worker-generated notifications; set to the public web origin.                                                                                           | Worker.                                                  |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PROFESSIONAL`                                                                                                                                                                                                                                 | Optional paid checkout and Stripe webhook processing. Configure all required Stripe values together and register `https://<api-host>/api/webhooks/stripe`. Secrets are server-only. | API.                                                     |
| `BILLING_ADMIN_USER_IDS`, `DATA_DELETION_OPERATOR_USER_IDS`                                                                                                                                                                                                                                               | Optional allowlists of server-provisioned operator user IDs for billing/deletion workflows. Server-only.                                                                            | API.                                                     |
| `CONTACT_WEBHOOK_URL`, `CONTACT_WEBHOOK_TOKEN`                                                                                                                                                                                                                                                            | Optional secure forwarding for public contact form submissions. URL must be HTTPS; token is secret.                                                                                 | Web.                                                     |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID`                                                                                                                                                                                                                                                                           | Optional analytics measurement ID, exposed to the browser; analytics are consent-gated.                                                                                             | Web.                                                     |
| `NEXT_PUBLIC_PROFESSIONAL_OFFER`, `NEXT_PUBLIC_ENTERPRISE_OFFER`                                                                                                                                                                                                                                          | Optional public pricing-page copy. Public.                                                                                                                                          | Web.                                                     |
| `API_REQUEST_MAX_BYTES`, `API_RATE_LIMIT_WINDOW_MS`, `API_RATE_LIMIT_MAX`                                                                                                                                                                                                                                 | Optional API request/rate limit tuning; defaults are set in code. Rate limiting is per process.                                                                                     | API.                                                     |
| `BULLMQ_PREFIX`                                                                                                                                                                                                                                                                                           | Optional BullMQ namespace when sharing a Redis database. Keep identical in API and worker.                                                                                          | API, worker.                                             |
| `SESSION_RETENTION_DAYS`, `WEBHOOK_RETENTION_DAYS`                                                                                                                                                                                                                                                        | Optional worker cleanup retention values; defaults are 30 and 90 days.                                                                                                              | Worker.                                                  |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`, `OTEL_SDK_DISABLED`, `OTEL_SERVICE_NAME`                                                                                                                                                      | Optional OpenTelemetry exporter configuration. Leave endpoints unset unless a reachable collector/backend is provided.                                                              | API.                                                     |
| `PLAN_FREE_NAME`, `PLAN_FREE_DESCRIPTION`, `PLAN_FREE_DISPLAY_PRICE`; `FREE_MAX_REPOSITORIES`, `FREE_ASSESSMENTS_PER_MONTH`, `FREE_RETENTION_DAYS`, `FREE_MAX_TEAM_MEMBERS`                                                                                                                               | Optional free-plan labels and entitlement overrides; server-only.                                                                                                                   | API.                                                     |
| `PLAN_PROFESSIONAL_NAME`, `PLAN_PROFESSIONAL_DESCRIPTION`, `PLAN_PROFESSIONAL_DISPLAY_PRICE`, `PLAN_PROFESSIONAL_INTERVAL`; `PROFESSIONAL_MAX_REPOSITORIES`, `PROFESSIONAL_ASSESSMENTS_PER_MONTH`, `PROFESSIONAL_ANALYSIS_JOBS_PER_MONTH`, `PROFESSIONAL_RETENTION_DAYS`, `PROFESSIONAL_MAX_TEAM_MEMBERS` | Optional Professional plan labels and entitlement overrides; server-only.                                                                                                           | API.                                                     |
| `PLAN_ENTERPRISE_NAME`, `PLAN_ENTERPRISE_DESCRIPTION`, `PLAN_ENTERPRISE_DISPLAY_PRICE`; `ENTERPRISE_DEFAULT_MAX_REPOSITORIES`, `ENTERPRISE_DEFAULT_ASSESSMENTS_PER_MONTH`, `ENTERPRISE_DEFAULT_ANALYSIS_JOBS_PER_MONTH`, `ENTERPRISE_DEFAULT_RETENTION_DAYS`, `ENTERPRISE_DEFAULT_MAX_TEAM_MEMBERS`       | Optional Enterprise plan labels and entitlement overrides; server-only.                                                                                                             | API.                                                     |

#### Obtaining values

- Render assigns each service's public URL and injects `PORT`. Use those generated HTTPS URLs for
  `APP_URL`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_API_URL`, callback registrations, and webhook
  registration as indicated above.
- Copy `DATABASE_URL` and any migration-only connection URL from the Supabase Connect dialog.
  Use the Redis provider's TCP connection URL for `REDIS_URL`; do not use an HTTP/REST endpoint.
- Obtain `GITHUB_APP_ID`, client ID/secret, and a newly generated private key from the GitHub App's
  settings. Choose a fresh random `GITHUB_WEBHOOK_SECRET` and configure the same value in GitHub.
  Get the public app slug from the GitHub App page.
- Generate `SOURCE_CONTROL_ENCRYPTION_KEY` as a base64-encoded 32-byte key, for example with
  `openssl rand -base64 32`. Generate it once, store it in the secrets manager, and back it up.
- Obtain GitLab/Bitbucket OAuth credentials from their provider app settings, and Azure DevOps OAuth
  credentials/tenant from the Microsoft Entra app registration. Register the exact generated
  callback URL for each enabled provider.
- Obtain Resend, Stripe, and Azure AI Foundry credentials from those provider dashboards only if
  enabling those features. Verify sender domains and Stripe webhook endpoint/signing secret before
  turning on outbound email or paid checkout.
- Set operator user-ID allowlists using the Nomalog `User.id` values of intentionally provisioned
  operators. Plan limits and public copy are operator-selected configuration, not credentials.

`SESSION_SECRET` may appear in older local configurations but is not read by runtime session code:
sessions are random opaque tokens backed by PostgreSQL. Do not rely on that variable as a production
signing secret or invent a value to compensate for missing database/session configuration.

`COMPOSE_DATABASE_URL`, `NGROK_DOMAIN`, `WEB_PORT`, `GRAFANA_ADMIN_PASSWORD`,
`CONTROLLED_ACCEPTANCE_DATABASE_URL`, `CONTROLLED_ACCEPTANCE_REDIS_URL`,
`SECURITY_REVIEW_DATABASE_URL`, and `SECURITY_REVIEW_REDIS_URL` are local, observability, or
test-only settings, not production app settings. `API_URL` in the local example is not consumed by
runtime code.

## Security and provider setup checklist

- Use HTTPS for the web and API generated URLs. Set `APP_URL` to the web URL so OAuth callbacks,
  credentialed CORS, and secure cookies use the right origin.
- Register GitHub OAuth and GitLab/Bitbucket/Azure DevOps callback URLs on the **web** host, because
  the Next `/api/auth/...` routes proxy callbacks to the API. Webhook URLs can use the web host for
  `/api/webhooks/github`, `/api/webhooks/bitbucket/:connectionId`, and
  `/api/webhooks/azure-devops/:connectionId`, which proxy required signature headers. Use the API
  host for GitLab `/api/webhooks/gitlab` and optional Stripe `/api/webhooks/stripe`. All provider
  webhooks also have API routes if configured directly against the API host.
- Keep provider secrets, database and Redis URLs, encryption key, Stripe credentials, and AI keys
  server-only. Only intentional public configuration belongs in `NEXT_PUBLIC_*`.
- Preserve webhook signature/token checks. Do not disable them to troubleshoot a delivery; inspect
  provider delivery status and server logs instead.
- Set `SOURCE_CONTROL_ENCRYPTION_KEY` once, back it up securely, and keep it stable across API/worker
  restarts and deployments. Loss or rotation without re-encryption prevents reading saved provider
  credentials.
- Configure backups and test restores before onboarding real customer data. Supabase Free
  availability/backup guarantees are limited; retain an independent encrypted backup process.
- Render's filesystem is ephemeral; this is currently acceptable because uploads are not stored on
  local disk. Do not add durable files to a service filesystem without object storage.

## Remaining decisions before provisioning

1. Choose a Redis-compatible TCP provider/plan compatible with BullMQ and determine its cost/limits.
2. Decide whether to pay for a continuously running worker, accept missing/delayed async features,
   or approve a separate architecture change.
3. Confirm current Render Free and Supabase Free limits and eligibility in their provider dashboards.
4. Create the provider apps/projects and register the final generated URLs; no external resources
   have been created as part of this preparation.
