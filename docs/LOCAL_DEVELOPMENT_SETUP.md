# Local Development Setup

This guide takes a fresh checkout from prerequisites through a running local
Nomalog stack. It describes the repository's Docker Compose setup and an
optional workflow for running the application processes directly on the host.
These settings are for local development only, not production.

## 1. Install prerequisites

Install the following on your development machine:

- Git
- Node.js 20 or newer
- pnpm 9.15.0 (the version pinned in `package.json`)
- Docker Engine with the Docker Compose plugin, or Docker Desktop
- `curl` for the readiness checks below

Check the versions:

```sh
node --version
pnpm --version
docker --version
docker compose version
```

If pnpm is not installed, enable Corepack and activate the pinned version:

```sh
corepack enable
corepack prepare pnpm@9.15.0 --activate
```

## 2. Get the repository and create local configuration

If you do not already have a checkout:

```sh
git clone https://github.com/Grd-32/ai-sdlc.git
cd ai-sdlc
```

From the repository root:

```sh
cp .env.example .env
```

Edit `.env` and set a unique local session secret. For example, generate a
random value with:

```sh
openssl rand -hex 32
```

Paste the generated value into `SESSION_SECRET`. Keep `.env` private; it is
ignored by Git. Never commit GitHub credentials, generated secrets, or real
customer data.

For the default local Compose database, the connection expected by host-side
commands is:

```dotenv
DATABASE_URL=postgresql://ai_sdlc:ai_sdlc_dev@localhost:5432/ai_sdlc?schema=public
REDIS_URL=redis://localhost:6379
```

Compose supplies its own container-to-container database and Redis addresses
(`postgres` and `redis`) to the API and worker. Do not change those host-side
addresses to Compose service names when running commands from your machine.
The API and worker use `COMPOSE_DATABASE_URL` for the Docker-network address.
If changing the database name or credentials, update both database URLs in
`.env`. If you change published ports in Compose, also update the host URL.

GitHub App values may remain empty while configuring the stack, but GitHub
sign-in and installation operations will not work until they are configured;
see [Expose the local app with ngrok](#7-expose-the-local-app-with-ngrok).

## 3. Install dependencies and generate Prisma client

```sh
pnpm install
pnpm db:generate
```

`pnpm db:generate` generates the Prisma client from the checked-in schema.
Re-run it after changing the Prisma schema or dependencies.

## 4. Start PostgreSQL and Redis

Start only the local data services first:

```sh
docker compose up -d postgres redis
docker compose ps postgres redis
```

Wait until both services show `healthy`. PostgreSQL is published on
`localhost:5432`; Redis is published on `localhost:6379`.

If either host port is already in use, do not stop an unknown process. Identify
the service using the port first, or deliberately change the published port in
`docker-compose.yml` and update the corresponding host URL in `.env`.

## 5. Apply database migrations

With Postgres healthy, apply the repository's committed Prisma migrations:

```sh
pnpm db:migrate
```

This runs Prisma's development migration command against `DATABASE_URL` from
`.env`. Do not use database reset or volume deletion as a troubleshooting
shortcut; those can permanently remove local data. To check migration status:

```sh
node ./scripts/run-with-env.mjs pnpm --filter @ai-sdlc/db exec prisma migrate status
```

The application containers do not apply migrations automatically. If the
status command reports every migration as pending while the database already
contains application tables, stop: that database has a schema without Prisma
migration history. Do not run migrations, reset it, or delete its volume until
you have confirmed whether its data must be preserved. For a clean local
development database that leaves the existing database untouched, create a
second database inside the running local PostgreSQL service:

```sh
docker compose exec -T postgres createdb -U ai_sdlc ai_sdlc_local
```

Then set both URLs in `.env` to the new database (preserve any URL-encoded
characters if you have changed the local password):

```dotenv
DATABASE_URL=postgresql://ai_sdlc:ai_sdlc_dev@localhost:5432/ai_sdlc_local?schema=public
COMPOSE_DATABASE_URL=postgresql://ai_sdlc:ai_sdlc_dev@postgres:5432/ai_sdlc_local?schema=public
```

Apply migrations to the new, empty database:

```sh
pnpm db:migrate
```

If `createdb` reports that `ai_sdlc_local` already exists, do not drop it; use
another unused local database name and update both URLs.

## 6. Start the complete application

Build and start the API, web app, worker, data services, and local observability
stack:

```sh
docker compose up -d --build
docker compose ps
```

The first build can take several minutes. Follow startup logs if needed:

```sh
docker compose logs -f --tail=100 api web worker postgres redis
```

Press `Ctrl+C` to stop following logs; this does not stop the containers.
If Compose warns that the Buildx plugin is missing, install Docker Buildx using
the instructions for your Docker Engine or Docker Desktop version. The warning
is separate from application build errors; if an image build fails, inspect
the first failing Dockerfile step and its error output.
Check API liveness and readiness:

```sh
curl -i http://localhost:3001/health
curl -i http://localhost:3001/health/ready
```

The liveness endpoint should return HTTP 200 while the API is running.
Readiness should return HTTP 200 with both `database` and `redis` set to `ok`.
The worker should log that it is listening on the `github` queue.

Open the local services:

| Service       | URL                     | Notes                                                              |
| ------------- | ----------------------- | ------------------------------------------------------------------ |
| Web dashboard | <http://localhost:3000> | Browser-facing UI                                                  |
| API           | <http://localhost:3001> | Includes `/health` and `/health/ready`                             |
| Prometheus    | <http://localhost:9090> | Metrics and alert rules                                            |
| Grafana       | <http://localhost:3002> | User `admin`; password `GRAFANA_ADMIN_PASSWORD` or default `admin` |

Set `GRAFANA_ADMIN_PASSWORD` in `.env` to change the local Grafana password.
The Compose observability stack is for local development; it has no paging
receiver or persistent trace backend. See [Local Observability](./OBSERVABILITY.md).

## 7. Expose the local app with ngrok

GitHub must be able to reach the OAuth callback, installation setup callback,
and webhook endpoint. Expose the web app on port `3000`; it forwards API calls
and webhooks to the API container. Do not expose API `3001`, PostgreSQL `5432`,
Redis `6379`, Grafana `3002`, or Prometheus `9090` publicly.

### 7.1 Install and authenticate ngrok

Install ngrok on the host using the instructions for your operating system at
<https://ngrok.com/download>. Create or sign into an ngrok account, then use
the command shown in your ngrok dashboard to add its authtoken to the local
ngrok agent configuration (commonly `ngrok config add-authtoken`, followed by
the token as an argument). Do not paste the token into this guide, `.env`,
application config, or a command transcript that will be shared.

### 7.2 Start an HTTPS tunnel

Leave Docker Compose running, then run this from a host terminal:

```sh
ngrok http 3000
```

On the ngrok Free plan this assigns a temporary URL that may change after the
tunnel restarts. Update the public URL settings below and the GitHub App URLs
whenever ngrok assigns a different URL. A fixed ngrok URL requires a reserved
domain supported by the account plan; attempting to bind a custom domain on the
current Free plan returns `ERR_NGROK_313`. Keep the tunnel and Docker Compose
running while testing. The web app proxies browser API calls and GitHub webhooks
internally to the API container, so a second public API tunnel is not needed.

### 7.3 Set the current public URL in `.env` and rebuild

Set these values in `.env` for the URL currently assigned by ngrok:

```dotenv
NGROK_DOMAIN=your-current-domain.ngrok-free.app
APP_URL=https://your-current-domain.ngrok-free.app
NEXT_PUBLIC_SITE_URL=https://your-current-domain.ngrok-free.app
NEXT_PUBLIC_API_URL=https://your-current-domain.ngrok-free.app/api/backend
GITHUB_APP_CALLBACK_URL=https://your-current-domain.ngrok-free.app/api/auth/github/callback
NEXT_PUBLIC_GITHUB_APP_SLUG=your-github-app-slug
```

Keep `API_INTERNAL_URL=http://api:3001` for web-server-to-API calls inside
Compose, and keep `COMPOSE_DATABASE_URL` pointed at the Docker-network database.
Do not replace internal service URLs with public ngrok URLs.
The GitHub App slug is the final path segment in its public URL,
`https://github.com/apps/<slug>`. The repositories page needs it to construct
the installation link; if it is empty, the page explains that GitHub App
installation is not configured.

`NEXT_PUBLIC_API_URL` is compiled into the web image at build time and is used
for browser-facing API calls; changing it requires rebuilding and recreating
the web container. OAuth and installation callbacks use same-origin web routes
so the browser's session cookie stays on the web tunnel's host. Compose passes
`NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_GITHUB_APP_SLUG` as Docker build
arguments. Rebuild and restart the app services after updating the URLs:

```sh
docker compose up -d --build api web worker
```

Check readiness and public reachability:

```sh
curl -i http://localhost:3001/health/ready
curl -i https://your-assigned-domain.ngrok-free.app/api/backend/health/ready
```

Open the dashboard using the assigned ngrok HTTPS URL. The web server uses
`API_INTERNAL_URL=http://api:3001` for server-side API calls; browser API
requests and incoming GitHub webhooks are proxied through that same public host.
Keep the ngrok terminal and Compose stack running for the entire GitHub test.

### 7.4 Create/configure the GitHub App

Create a GitHub App dedicated to development in GitHub Developer Settings. Do
not reuse production credentials. Use the same assigned ngrok domain for all
public GitHub App URLs:

| GitHub App setting              | Value                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------- |
| Homepage URL                    | `https://your-assigned-domain.ngrok-free.app`                                   |
| User authorization callback URL | `https://your-assigned-domain.ngrok-free.app/api/auth/github/callback`          |
| Setup URL                       | `https://your-assigned-domain.ngrok-free.app/api/github/installations/callback` |
| Webhook URL                     | `https://your-assigned-domain.ngrok-free.app/api/webhooks/github`               |
| Webhook secret                  | A newly generated local secret; use the same value in `.env`                    |

Set the Setup URL to the exact `/api/github/installations/callback` path once
(do not append another `/callback` segment). This callback synchronizes selected
repositories into the Nomalog organization after the installation is linked.
GitHub's **Redirect on update** option sends installation updates through the
User authorization callback URL instead of the Setup URL; when an installation
is started from Nomalog, its short-lived organization context lets that callback
complete the installation synchronization. Enable the
webhook. Subscribe at least to **Pull request** and **Installation** events:
pull-request events drive analysis, and installation deletion lets the app
disable removed installations. For pull requests, the app analyzes opened,
edited, synchronized, reopened, and ready-for-review actions.

Grant only the repository permissions needed for the workflows you intend to
test. The current GitHub integration reads repository contents, pull requests,
issues, checks, metadata, and repository hooks; publishing Check Runs requires
the corresponding Checks write permission. Free assessments also read current
repository Code Scanning and Dependabot alerts. Grant **Code scanning alerts:
Read-only** and **Dependabot alerts: Read-only** to the GitHub App and approve
the permission update for each existing installation. If either feature is
disabled or unavailable to the App, the report marks that coverage as unknown
or not run rather than clean. For GitHub sign-in, open the
development GitHub App's **Permissions & events** settings, find **Account
permissions**, set **Email addresses** to **Read-only**, and save the change.
This allows the callback to read the account's verified email from GitHub's
`/user/emails` endpoint when the profile's public email is hidden. After saving,
authorize the app again and approve the updated permission. Also make sure your
GitHub account has at least one verified email address. Install the development
App on a disposable test repository or organization.

Copy the App ID, Client ID, and Client Secret from GitHub into `.env`. Generate
a distinct webhook secret and enter it both in GitHub's Webhook secret field
and `.env` as `GITHUB_WEBHOOK_SECRET`. For App-authenticated API operations,
generate/download a private key and configure its contents as described below.
Do not commit `.env`, the PEM file, or the encoded key.

```dotenv
GITHUB_APP_ID=your-app-id
GITHUB_APP_CLIENT_ID=your-client-id
GITHUB_APP_CLIENT_SECRET=your-client-secret
GITHUB_APP_PRIVATE_KEY_BASE64=your-base64-encoded-private-key
GITHUB_WEBHOOK_SECRET=your-webhook-secret
GITHUB_APP_BASE_URL=https://api.github.com
GITHUB_APP_CALLBACK_URL=https://your-assigned-domain.ngrok-free.app/api/auth/github/callback
NEXT_PUBLIC_GITHUB_APP_SLUG=your-github-app-slug
```

`GITHUB_APP_BASE_URL` is the GitHub REST API base URL, not the GitHub App's
settings or public page URL. Use `https://api.github.com` for github.com.

The code accepts the private key as base64 to avoid newline and quoting
problems in `.env`. Put the encoded output in
`GITHUB_APP_PRIVATE_KEY_BASE64` (not `GITHUB_APP_PRIVATE_KEY`, which is reserved
for a raw PEM value). Encode the PEM locally and copy the output directly into
the ignored `.env` file:

```sh
base64 -w0 path/to/your-github-app-private-key.pem
```

After saving credentials, recreate API and worker to load runtime environment
changes. The web app must be rebuilt if its public API URL or App slug changed:

```sh
docker compose up -d --build api worker web
```

### 7.5 Test login, installation, and webhook delivery

1. Open `https://your-assigned-domain.ngrok-free.app` and select **Sign in with GitHub**.
   GitHub should return to the web-hosted callback route, which forwards to the
   API and then redirects to the web dashboard.
2. On first sign-in, create an organization in the onboarding screen; your
   account becomes its owner. Users who should join an existing organization
   should ask its owner to add their GitHub account instead. Once you reach the
   dashboard, open **Repositories** and select **Install GitHub App**. Start
   the installation from this button (not from a saved/direct GitHub install
   link): the app verifies your organization admin access and preserves the
   organization context for GitHub's return redirect. GitHub returns to the
   web-hosted Setup URL, which forwards to the API; the callback verifies
   access again and synchronizes the selected repositories into the app.
3. Open the development repository and create or update a pull request.
4. In the GitHub App settings, inspect recent webhook deliveries. A successful
   delivery should receive HTTP 202; invalid signatures receive HTTP 401, and a
   conflicting reuse of a delivery ID receives HTTP 409.
5. Inspect local processing logs:

   ```sh
   docker compose logs --tail=100 api worker
   ```

   Do not share logs or ngrok inspector payloads without checking for private
   repository data and personal information.

### 7.6 Understand AI attribution and security evidence

AI attribution is deliberately evidence-based. A pull request is marked as
AI-assisted when its text explicitly declares AI use, a commit message contains
an `AI-Assisted-By: GitHub Copilot` (or supported agent) trailer, or GitHub
identifies its author as a recognized AI coding-agent bot. For example, to
declare Copilot assistance in a commit, add this trailer on its own line:

```text
AI-Assisted-By: GitHub Copilot
```

You can also put `AI-Assisted-By: GitHub Copilot` in the pull request
description. Editing the pull request description triggers a fresh attribution
and policy analysis. Copilot's normal inline VS Code suggestions do not add
provenance to the Git commit or GitHub webhook, so without an explicit signal
the system cannot reliably tell that those edits used Copilot. Ordinary
mentions of an assistant are not enough. When the available metadata is
inconclusive, the UI reports **Unattributed**; this does not mean AI was or was
not used. Confidence is shown only for positive signals, not for unknown
attribution.

Risk scores are produced by the deterministic `risk-v2` rules engine from
AI-provenance classification, repository criticality, changed-file
classifications, change size, changed dependency-manifest file count, actual
security-finding severities, and recorded evidence outcomes. The assessment
report records the contributing factors and methodology version. This score is
not an LLM code review. The
optional Azure AI Foundry reviewer is disabled by default. To enable it, deploy
an Azure OpenAI model and set these server-only variables in `.env`:

```dotenv
AI_CODE_REVIEW_ENABLED=true
AZURE_OPENAI_BASE_URL=https://YOUR-RESOURCE.openai.azure.com/openai/v1/
AZURE_OPENAI_API_KEY=your-server-side-key
AZURE_OPENAI_MODEL=your-model-deployment-name
```

The endpoint uses the [Azure OpenAI v1 chat completions API](https://learn.microsoft.com/en-us/azure/foundry/openai/api-version-lifecycle).
Only changed-file diff hunks are sent, with a 50,000-character limit; if a
complete diff is unavailable or too large, the review is **NOT RUN**. Review
findings are suggestions and require human verification. Do not place the API
key in a `NEXT_PUBLIC_*` variable or commit it. Enabling the feature sends
private source-code diffs to the configured Azure resource; confirm your
organization's data-handling and retention requirements first.

GitHub
CodeQL/code-scanning evidence is read from the repository's Code Scanning API
and is reported as **PASS** only when a successful CodeQL check exists for the
current pull request head and no open alerts match that commit. Enable CodeQL
for the repository and grant the GitHub App **Checks: read** and **Code
scanning alerts: read** repository permissions, then accept the updated
permissions for its installation. Semgrep, Snyk, and Sonar still report
**NOT RUN** until their providers are configured; **NOT RUN** must never be
interpreted as a passing security scan. Review the factor breakdown on each
change and the source details on the Evidence page.

If login reports an OAuth state mismatch, start a fresh login from the web
ngrok URL in the same browser profile and finish within 10 minutes. Do not
reload or reuse an old GitHub authorization/callback page, run multiple login
attempts in parallel tabs, or switch between localhost and the ngrok host:
each login replaces the short-lived state cookie, and the callback consumes it.
If a fresh attempt still fails, inspect the callback request in browser
developer tools and confirm it includes the `ai_sdlc_oauth_state` cookie; do
not copy or share the cookie value. If GitHub reports a callback mismatch,
compare the configured URL character-for-character with the value of
`GITHUB_APP_CALLBACK_URL`. If webhook delivery fails, confirm that the
assigned ngrok tunnel is active, the GitHub App webhook URL uses the same
assigned domain, and its secret exactly matches `GITHUB_WEBHOOK_SECRET`.

Ngrok makes this development instance reachable from the internet. Use a
development GitHub App and disposable test data, keep app credentials private,
and stop the ngrok tunnel when finished. Never expose a production instance
through a development tunnel.

### 7.7 Configure the GitLab.com connection foundation

The current GitLab integration supports GitLab.com OAuth, encrypted credential
storage, project discovery, explicit repository selection, and disconnection.
Selected GitLab projects enter the shared assessment and analysis pipeline;
webhook-triggered analysis is available after project webhook setup. The
provider limitations below still apply. GitLab self-managed hosts are not
supported. Bitbucket Cloud and Azure DevOps now have application OAuth,
encrypted connection storage, scoped resource discovery, explicit repository
selection, quota enforcement, disconnect workflows, and on-demand assessment
and analysis. Bitbucket Cloud uses bounded complete unified diffs; native
secret scanning is unavailable, while branch-restriction configurations are
collected but not treated as proof of effective enforcement. Azure DevOps
uses bounded current-iteration text diffs; binary files lack text patches and
oversized or overly complex diffs fail rather than enter analysis. Both
providers support authenticated pull-request webhook-triggered analysis after
manual setup; neither has live provider verification or complete continuous
repository monitoring.

1. Create a GitLab.com OAuth application and register the exact callback URI:
   `https://your-assigned-domain.ngrok-free.app/api/auth/gitlab/callback`.
   For local-only testing use `http://localhost:3000/api/auth/gitlab/callback`.
2. Keep the requested scopes read-only: `read_user`, `read_api`, and
   `read_repository`. Do not grant write permissions for this foundation.
3. Set the OAuth application values and a locally generated encryption key in
   the ignored `.env` file:

   ```dotenv
   GITLAB_OAUTH_CLIENT_ID=your-gitlab-oauth-client-id
   GITLAB_OAUTH_CLIENT_SECRET=your-gitlab-oauth-client-secret
   GITLAB_OAUTH_CALLBACK_URL=https://your-assigned-domain.ngrok-free.app/api/auth/gitlab/callback
   SOURCE_CONTROL_ENCRYPTION_KEY=your-base64-encoded-32-byte-key
   ```

   Generate the encryption key locally with `openssl rand -base64 32`. Keep
   it unchanged and backed up securely: replacing it makes existing encrypted
   GitLab credentials unreadable. Never place it in a `NEXT_PUBLIC_` variable
   or commit it.

4. Recreate the API and web services so they load the OAuth settings:

   ```sh
   docker compose up -d --build api web
   ```

5. Sign in, open **Repositories**, and connect GitLab.com as an organisation
   administrator. Select only the projects that should be associated with the
   organisation. Disconnecting disables selected repositories locally and
   attempts to revoke the GitLab OAuth token; if remote revocation fails, also
   revoke the grant in GitLab account settings.

OAuth and repository selection have automated provider and API tests, but a
live GitLab account has not been used for verification. Selected GitLab
projects can now be included in the on-demand assessment and use the shared
change analysis, risk, policy, evidence, and Change Passport pipeline. The
worker also refreshes encrypted GitLab OAuth credentials server-side.
For webhook-triggered merge-request analysis, use **Create webhook secret** in
the GitLab connection panel, then configure each selected GitLab project under
**Settings → Webhooks** with the displayed URL and secret token and enable only
**Merge request events**. The secret is shown once; rotating it invalidates the
previous token. Only events for projects linked to that specific connection
are processed, and stale deliveries cannot overwrite newer merge-request
metadata. GitLab webhook setup and live delivery have not yet been verified
against an external GitLab account. This provides merge-request-triggered
analysis, not complete continuous monitoring of every repository change.
GitLab vulnerability findings are requested only for pipelines whose commit
SHA matches the analyzed merge-request head; access to GitLab's vulnerability
findings API depends on GitLab tier and permissions. Secret-detection results
are read only when the matching pipeline has a successful `secret_detection`
job with an accessible report artifact. Secret values are discarded before
findings are persisted. Protected-branch settings are collected for the exact
target/default branch; wildcard protection and approval rules are not inferred.
Unavailable reports remain `NOT_RUN`, not clean. An empty vulnerability
finding response is `UNKNOWN` because it does not prove that a scanner ran.
Secret-report redirects are restricted to HTTPS GitLab or known object-storage
hosts, and the GitLab token is never sent to the redirected host. The
assessment fails rather than assigning a potentially understated risk score
when GitLab omits or truncates changed-file diffs.

### 7.8 Configure Bitbucket Cloud and Azure DevOps connections

The source-control package contains read-only API clients and OAuth token
exchange/refresh primitives for Bitbucket Cloud and Azure DevOps. Bitbucket
diff content is bounded to 5 MiB and must match the provider's complete
diffstat file set before it can enter analysis. The Azure OAuth flow uses
Microsoft Entra ID with PKCE; legacy Azure DevOps OAuth app registrations are
deprecated and must not be used for a new integration.
Mocked contract tests cover OAuth requests, account/workspace/project discovery,
repository listing, pull-request normalization, provider pagination,
changed-file metadata, Azure branch policy parsing, and application selection
authorization. The dashboard supports provider connection, explicit workspace
or project/repository selection, repository quota checks, and disconnection.
Bitbucket Cloud and Azure DevOps also support authenticated pull-request
webhook-triggered analysis for selected repositories. The provider flows have
not been verified against live accounts.

For Bitbucket Cloud, create an OAuth consumer with read-only `account`,
`repository`, and `pullrequest` scopes. Register
`https://your-assigned-domain.ngrok-free.app/api/auth/bitbucket/callback`
(or `http://localhost:3000/api/auth/bitbucket/callback` locally). Configure:

```dotenv
BITBUCKET_OAUTH_CLIENT_ID=your-consumer-key
BITBUCKET_OAUTH_CLIENT_SECRET=your-consumer-secret
BITBUCKET_OAUTH_CALLBACK_URL=https://your-assigned-domain.ngrok-free.app/api/auth/bitbucket/callback
SOURCE_CONTROL_ENCRYPTION_KEY=your-base64-encoded-32-byte-key
```

For Azure DevOps, register a Microsoft Entra application with the read-only
`vso.project` and `vso.code` delegated scopes. Add `vso.advsec` if you want the
assessment and shared analysis to read Azure DevOps Advanced Security alerts;
this permission is used only for alert reads and is never required for basic
repository discovery/diff analysis. The application rejects other `vso.*`
scopes, including write scopes. New consent is requested during the OAuth
connection flow. Existing connections without `vso.advsec` remain usable for
repository activity, but native alerts are `NOT_RUN` until an organization
administrator reconnects and grants the additional permission. The alert API
returns current active findings only; an empty result does not prove a scanner
is enabled or that the 30-day history is complete. Register
`https://your-assigned-domain.ngrok-free.app/api/auth/azure-devops/callback`
(or `http://localhost:3000/api/auth/azure-devops/callback` locally). Set:

```dotenv
AZURE_DEVOPS_OAUTH_CLIENT_ID=your-entra-application-id
AZURE_DEVOPS_OAUTH_CLIENT_SECRET=your-server-side-client-secret
AZURE_DEVOPS_OAUTH_CALLBACK_URL=https://your-assigned-domain.ngrok-free.app/api/auth/azure-devops/callback
AZURE_DEVOPS_TENANT_ID=organizations
SOURCE_CONTROL_ENCRYPTION_KEY=your-base64-encoded-32-byte-key
```

For either provider, keep the same server-only 32-byte encryption key across
restarts and backups. Never use `NEXT_PUBLIC_` variables for credentials.
Rebuild/restart the API and web services after changing OAuth configuration.
An organization administrator connects the account, selects a visible
workspace/project, and then selects repositories. Azure DevOps additionally
requires the provider organization slug. Bitbucket access is revoked remotely
when supported; for Azure DevOps, disconnecting immediately disables local
access and linked repositories, but the user must revoke the Microsoft Entra
consent grant in account settings.

For Bitbucket Cloud webhook-triggered pull-request analysis, open **Repositories**
as an organization administrator and choose **Create webhook secret** for the
connected Bitbucket account. Copy the displayed URL and secret immediately;
the secret is shown only once. In each selected Bitbucket repository, create a
webhook using that URL and secret and enable pull-request created and updated
events. The receiver verifies the signed raw payload, accepts only repositories
selected for that connection, deduplicates delivery UUIDs, and prevents older
updates from replacing newer pull-request metadata. Rotating the secret
invalidates signatures made with the previous secret, so update the configured
repository webhooks after rotation. The API must be reachable from Bitbucket.
This provides event-triggered pull-request analysis, not continuous repository
polling or complete monitoring. The setup and delivery have mocked tests only;
Bitbucket webhook behavior has not been verified against a live account.

For Azure DevOps Service Hooks, open **Repositories** as an organization
administrator and choose **Configure Service Hooks** for the connected
organization. Copy the one-time URL, username, and password. In each selected
Azure DevOps project, open **Project settings → Service hooks**, create a
**Web Hooks** subscription for **Pull request created** and **Pull request
updated**, and use the displayed URL and Basic authentication credentials.
Use an HTTPS endpoint and set **Resource details to send** to **All**. The
receiver authenticates the request, accepts only selected repositories,
deduplicates event UUIDs, and prevents older deliveries from overwriting newer
pull-request metadata. Rotating the password invalidates the previous
credentials. An authenticated `servicehook.test` request is acknowledged
without being treated as a pull-request event. This provides event-triggered
analysis only, not complete repository monitoring. The service-hook setup and
delivery have mocked tests only; live behavior has not been verified.

The provider adapters and application flow still have bounded coverage:

- Bitbucket Cloud supports 30-day assessment and on-demand change analysis.
  Native secret scanning is not integrated; branch-restriction configurations
  are collected but their rule semantics and effective enforcement are not
  verified;
  participant approvals do not have a matching head SHA or reliable approval
  timestamp. Pipelines are matched to the current head where permissions allow.
- Azure DevOps now uses the latest PR iteration's common-base and source commits
  to fetch changed text and build bounded unified diffs for shared on-demand
  analysis and 30-day assessments. Unsupported change types and binary files
  cannot produce complete text patches; over 200 changed files, over 5 MiB
  aggregate content, and overly complex diffs fail explicitly.
  Its pull-request window is based on the
  provider's creation-time query and is not a complete event-history window.
  Reviewer votes are not tied to a timestamp/current iteration; PR statuses
  and branch policy configurations remain UNKNOWN rather than verified passes.
- Bitbucket's PR listing is based on the provider's updated-time query.
- Neither adapter is live-tested against a customer account. Both support
  authenticated pull-request webhook-triggered analysis but not continuous
  repository monitoring.

Do not represent Bitbucket or Azure DevOps as continuously monitored. Before a
controlled pilot, verify OAuth configuration against disposable provider
projects and complete provider-backed webhook, diff, worker, assessment, and
operational failure testing.

## 8. Run code checks and database-backed tests

The repeatable database-independent security gate is:

```sh
pnpm security:review
```

It runs focused tests and API/DB typechecks. Database-backed route and
service-account tests require a dedicated, disposable PostgreSQL database and
Redis instance. Set the following environment variables to those test
services—not to a database or Redis instance containing data you need to keep:

```sh
export SECURITY_REVIEW_DATABASE_URL='postgresql://USER:PASSWORD@HOST:PORT/TEST_DATABASE?schema=public'
export SECURITY_REVIEW_REDIS_URL='redis://HOST:PORT'
```

Apply migrations to that dedicated test database before running integration
tests:

```sh
DATABASE_URL="$SECURITY_REVIEW_DATABASE_URL" pnpm db:migrate
pnpm security:review --with-database
```

The review runner passes these isolated URLs to the tests and refuses to run
database tests if either is missing. Clear the shell variables when finished:

```sh
unset SECURITY_REVIEW_DATABASE_URL SECURITY_REVIEW_REDIS_URL
```

The full workspace test suite can be run with:

```sh
pnpm test
```

Some tests need database/Redis services. A database connection failure means
the integration assertions did not complete; it is not a passing test result.

## 8.1 Run controlled end-to-end acceptance

The controlled acceptance runner applies committed migrations to a dedicated
local PostgreSQL database, then runs provider-response fixtures, webhook
authentication/replay/retry tests, database-backed API tests, and the worker
golden path using local Redis. The API suite includes policy-history simulation
revision snapshot and approval quorum checks; database-backed checks also verify
that revision mutation is rejected by PostgreSQL triggers and that only current
approvals from eligible active members count. It refuses a database name that does not contain
`test` or `acceptance`, and it refuses non-local PostgreSQL hosts. Never point
it at a database containing data you need to keep.

Create a new empty database using the database credentials configured for your
local Compose Postgres service. Use a unique name containing `acceptance`:

```sh
docker compose exec -T postgres createdb -U ai_sdlc ai_sdlc_acceptance_test
```

Then run the controlled suite with explicit URLs:

```sh
CONTROLLED_ACCEPTANCE_DATABASE_URL='postgresql://ai_sdlc:ai_sdlc_dev@localhost:5432/ai_sdlc_acceptance_test?schema=public' \
CONTROLLED_ACCEPTANCE_REDIS_URL='redis://localhost:6379' \
pnpm test:acceptance:controlled
```

This applies migrations only to the named acceptance database. Tests use
controlled identity and provider fixtures; the worker golden path exercises
the internal webhook-to-analysis flow with provider network calls mocked.
**A pass is mocked/controlled local acceptance, not a browser journey or live
GitHub, payment, GitLab, Bitbucket, or Azure DevOps verification.**

The runner leaves its test database in place for inspection. After confirming
the database name is the disposable one created for this run and the tests are
finished, remove only that database with:

```sh
docker compose exec -T postgres dropdb -U ai_sdlc ai_sdlc_acceptance_test
```

## 9. Run processes directly on the host (optional)

Use this mode for faster TypeScript edit/reload cycles. Keep Postgres and Redis
running in Compose as described above, and apply migrations first. Start each
application process in a separate terminal from the repository root:

Build the workspace packages and applications once before starting the native
processes:

```sh
pnpm build
```

Terminal 1 — API:

```sh
pnpm dev:api
```

Terminal 2 — background worker:

```sh
pnpm dev:worker
```

Terminal 3 — web app:

```sh
pnpm dev:web
```

The native web app uses `http://localhost:3001` as its API URL by default. If
you override API ports, keep `API_PORT`, `NEXT_PUBLIC_API_URL`, and
`API_INTERNAL_URL` consistent. In Compose, `API_INTERNAL_URL` must use
`http://api:3001`; from the host, use `http://localhost:3001`.

Stop each native process with `Ctrl+C`. Stop only the dependency containers
when done:

```sh
docker compose stop postgres redis
```

## 10. Stop and preserve local data

Stop the complete Compose stack while preserving its named volumes:

```sh
docker compose down
```

Start it again with `docker compose up -d`. Avoid `docker compose down -v`:
the `-v` option deletes the Postgres, Redis, Prometheus, and Grafana volumes,
including local data.

## Troubleshooting

### API readiness fails

Check `docker compose ps postgres redis`, then inspect only the relevant logs:

```sh
docker compose logs --tail=100 postgres redis api
```

Confirm `.env` has the host-side Postgres and Redis URLs shown above. Inside
Compose, API and worker receive Compose-specific connection URLs automatically.

### Migration or Prisma errors

Generate the Prisma client with `pnpm db:generate`, confirm Postgres is healthy,
and check `pnpm --filter @ai-sdlc/db exec prisma migrate status`. Do not reset a
database or remove a volume unless you explicitly intend to destroy its data.

### GitHub sign-in fails

Confirm the GitHub App client ID, client secret, callback URL, and configured
GitHub App authorization settings match exactly. Check API logs with
`docker compose logs --tail=100 api`; do not paste tokens or secrets into
support requests.

### A port is already occupied

Check which process owns the port before changing or stopping anything. Compose
publishes Postgres on 5432, Redis on 6379, web on 3000, API on 3001, Prometheus
on 9090, and Grafana on 3002. If changing a published port, update the
corresponding host-side URL and any browser-facing URL.

## What local setup does not provide

This setup is not production deployment guidance. It does not configure
production TLS, secret management, outbound alert delivery, production backup
retention, or an on-call response team. Review the [Operations Runbook](./OPERATIONS_RUNBOOK.md)
and [Disaster Recovery Plan](./DISASTER_RECOVERY.md) before using another
environment.
