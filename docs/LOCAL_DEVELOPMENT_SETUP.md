# Local Development Setup

This guide takes a fresh checkout from prerequisites through a running local
AI-SDLC stack. It describes the repository's Docker Compose setup and an
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
and webhook endpoint. For this Compose setup, expose **both** local application
ports: web `3000` and API `3001`. Do not tunnel PostgreSQL `5432`, Redis `6379`,
Grafana `3002`, or Prometheus `9090`.

### 7.1 Install and authenticate ngrok

Install ngrok on the host using the instructions for your operating system at
<https://ngrok.com/download>. Create or sign into an ngrok account, then use
the command shown in your ngrok dashboard to add its authtoken to the local
ngrok agent configuration (commonly `ngrok config add-authtoken`, followed by
the token as an argument). Do not paste the token into this guide, `.env`,
application config, or a command transcript that will be shared.

### 7.2 Start two HTTPS tunnels

Leave Docker Compose running. Open two host terminals from any directory:

Terminal 1 — public web dashboard:

```sh
ngrok http 3000
```

Terminal 2 — public API:

```sh
ngrok http 3001
```

Each terminal displays a forwarding address. Copy the **HTTPS** address for
each tunnel, for example `https://web-example.ngrok-free.app` and
`https://api-example.ngrok-free.app`. Keep both ngrok terminals running while
using the integration. If your ngrok account provides reserved domains, use
them so the URLs do not change. With temporary URLs, repeat the GitHub App
callback/webhook configuration and rebuild the web app whenever a URL changes.
Your ngrok account must allow both endpoints to be active at the same time.

### 7.3 Set public URLs in `.env` and rebuild

In `.env`, set the web and API addresses to the exact HTTPS forwarding URLs.
Do not add a trailing slash:

```dotenv
APP_URL=https://web-example.ngrok-free.app
NEXT_PUBLIC_API_URL=https://api-example.ngrok-free.app
GITHUB_APP_CALLBACK_URL=https://web-example.ngrok-free.app/api/auth/github/callback
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
curl -i https://api-example.ngrok-free.app/health
```

Open the dashboard using the **web ngrok HTTPS URL**, not localhost. The web
server uses `API_INTERNAL_URL=http://api:3001` for server-side API calls;
browser-facing API requests use the public API URL. Keep both ngrok terminals
and the Compose stack running for the entire GitHub test.

### 7.4 Create/configure the GitHub App

Create a GitHub App dedicated to development in GitHub Developer Settings. Do
not reuse production credentials. Use the two ngrok HTTPS addresses as follows:

| GitHub App setting              | Value                                                                  |
| ------------------------------- | ---------------------------------------------------------------------- |
| Homepage URL                    | `https://web-example.ngrok-free.app`                                   |
| User authorization callback URL | `https://web-example.ngrok-free.app/api/auth/github/callback`          |
| Setup URL                       | `https://web-example.ngrok-free.app/api/github/installations/callback` |
| Webhook URL                     | `https://api-example.ngrok-free.app/api/webhooks/github`               |
| Webhook secret                  | A newly generated local secret; use the same value in `.env`           |

Enable **Redirect on update** for the Setup URL so GitHub returns to the
installation callback after installation permission changes. Use the exact
`/api/github/installations/callback` path once (do not append another
`/callback` segment). The callback synchronizes selected repositories into the
organization after the installation is linked. Enable the
webhook. Subscribe at least to **Pull request** and **Installation** events:
pull-request events drive analysis, and installation deletion lets the app
disable removed installations. For pull requests, the app analyzes opened,
synchronized, reopened, and ready-for-review actions.

Grant only the repository permissions needed for the workflows you intend to
test. The current GitHub integration reads repository contents, pull requests,
issues, checks, metadata, and repository hooks; publishing Check Runs requires
the corresponding Checks write permission. For GitHub sign-in, open the
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
GITHUB_APP_CALLBACK_URL=https://web-example.ngrok-free.app/api/auth/github/callback
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

1. Open `https://web-example.ngrok-free.app` and select **Sign in with GitHub**.
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

If login reports an OAuth state mismatch, start a fresh login from the web
ngrok URL in the same browser profile and finish within 10 minutes. Do not
reload or reuse an old GitHub authorization/callback page, run multiple login
attempts in parallel tabs, or switch between localhost and the ngrok host:
each login replaces the short-lived state cookie, and the callback consumes it.
If a fresh attempt still fails, inspect the callback request in browser
developer tools and confirm it includes the `ai_sdlc_oauth_state` cookie; do
not copy or share the cookie value. If GitHub reports a callback mismatch,
compare the configured URL character-for-character with the value of
`GITHUB_APP_CALLBACK_URL`. If webhook delivery fails, confirm that the API
tunnel is active, the webhook URL uses the API tunnel, and the secret exactly
matches `GITHUB_WEBHOOK_SECRET`.

Ngrok makes this development instance reachable from the internet. Use a
development GitHub App and disposable test data, keep app credentials private,
and stop both tunnels when finished. Never expose a production instance through
a development tunnel.

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
