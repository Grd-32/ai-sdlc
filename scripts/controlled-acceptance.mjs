#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repositoryRoot = process.cwd();
const envPath = resolve(repositoryRoot, ".env");
if (existsSync(envPath)) process.loadEnvFile(envPath);

const databaseUrl = process.env["CONTROLLED_ACCEPTANCE_DATABASE_URL"];
const redisUrl = process.env["CONTROLLED_ACCEPTANCE_REDIS_URL"];
if (!databaseUrl || !redisUrl) {
  console.error(
    "Set CONTROLLED_ACCEPTANCE_DATABASE_URL and CONTROLLED_ACCEPTANCE_REDIS_URL to disposable local test services.",
  );
  process.exit(2);
}

let targetUrl;
let databaseName;
try {
  targetUrl = new URL(databaseUrl);
  databaseName = decodeURIComponent(targetUrl.pathname.replace(/^\//, ""));
} catch {
  console.error("CONTROLLED_ACCEPTANCE_DATABASE_URL must be a valid PostgreSQL URL.");
  process.exit(2);
}

if (!/(test|acceptance)/i.test(databaseName)) {
  console.error(
    "Refusing to migrate a database whose name does not include 'test' or 'acceptance'.",
  );
  process.exit(2);
}
if (
  databaseName === "postgres" ||
  !["postgres:", "postgresql:"].includes(targetUrl.protocol) ||
  (targetUrl.hostname !== "localhost" && targetUrl.hostname !== "127.0.0.1")
) {
  console.error("Controlled acceptance tests are restricted to local PostgreSQL databases.");
  process.exit(2);
}
try {
  const localRedisUrl = new URL(redisUrl);
  if (
    !["redis:", "rediss:"].includes(localRedisUrl.protocol) ||
    !["localhost", "127.0.0.1"].includes(localRedisUrl.hostname)
  ) {
    throw new Error("non-local Redis URL");
  }
} catch {
  console.error("CONTROLLED_ACCEPTANCE_REDIS_URL must point to local Redis.");
  process.exit(2);
}

const configuredDatabaseUrl = process.env["DATABASE_URL"];
if (configuredDatabaseUrl) {
  try {
    const configuredUrl = new URL(configuredDatabaseUrl);
    const configuredName = decodeURIComponent(configuredUrl.pathname.replace(/^\//, ""));
    if (configuredName === databaseName) {
      console.error("Acceptance database URL conflicts with the configured DATABASE_URL.");
      process.exit(2);
    }
  } catch {
    console.error("Configured DATABASE_URL is invalid; refusing ambiguous database selection.");
    process.exit(2);
  }
}

const environment = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  REDIS_URL: redisUrl,
  RESEND_API_KEY: "",
  EMAIL_FROM: "",
  SESSION_SECRET:
    process.env["SESSION_SECRET"] ?? "controlled-acceptance-session-secret-not-for-production",
};

const checks = [
  {
    name: "Apply committed migrations to the disposable acceptance database",
    args: ["--filter", "@ai-sdlc/db", "exec", "prisma", "migrate", "deploy"],
  },
  {
    name: "Build the database package used by API and worker fixtures",
    args: ["--filter", "@ai-sdlc/db", "build"],
  },
  {
    name: "Bitbucket and Azure DevOps response fixtures",
    args: [
      "--filter",
      "@ai-sdlc/source-control",
      "exec",
      "vitest",
      "run",
      "src/bitbucket.test.ts",
      "src/azure-devops.test.ts",
    ],
  },
  {
    name: "Webhook authentication, replay, stale-event, and retry behavior",
    args: [
      "--filter",
      "@ai-sdlc/api",
      "exec",
      "vitest",
      "run",
      "src/webhooks.test.ts",
      "src/bitbucket-webhooks.test.ts",
      "src/azure-devops-webhooks.test.ts",
      "src/gitlab-webhooks.test.ts",
    ],
  },
  {
    name: "Assessment queue failures, retries, and integration disconnects",
    args: [
      "--filter",
      "@ai-sdlc/api",
      "exec",
      "vitest",
      "run",
      "src/routes/notifications.test.ts",
      "src/routes/assessments.test.ts",
      "src/routes/settings.test.ts",
      "src/routes/third-party-source-control.test.ts",
    ],
  },
  {
    name: "Database-backed API authorization and webhook routes",
    args: [
      "--filter",
      "@ai-sdlc/api",
      "exec",
      "vitest",
      "run",
      "src/app.test.ts",
      "src/tenant-isolation.test.ts",
      "src/lifecycle-workflows.test.ts",
      "src/routes/policy-management.test.ts",
    ],
  },
  {
    name: "Database-enforced policy revision and approval controls",
    args: [
      "--filter",
      "@ai-sdlc/db",
      "exec",
      "vitest",
      "run",
      "src/policy-revisions.test.ts",
      "src/policy-approvals.test.ts",
      "src/change-passport-integrity.test.ts",
      "src/notification-category.test.ts",
    ],
  },
  {
    name: "Specialized review-role eligibility rules",
    args: ["--filter", "@ai-sdlc/policy", "exec", "vitest", "run", "src/review-approval.test.ts"],
  },
  {
    name: "Controlled worker analysis and assessment path",
    args: [
      "--filter",
      "@ai-sdlc/worker",
      "exec",
      "vitest",
      "run",
      "src/golden-path.test.ts",
      "src/processors/assessment.test.ts",
      "src/processors/notifications.test.ts",
      "src/processors/invitation-notifications.test.ts",
      "src/processors/risk-acceptance-expiry.test.ts",
      "src/processors/finding-sla-escalation.test.ts",
      "src/notification-events.test.ts",
      "src/retention-scheduler.test.ts",
    ],
  },
];

for (const check of checks) {
  console.log(`\n[controlled acceptance] ${check.name}`);
  const result = spawnSync("pnpm", check.args, {
    cwd: repositoryRoot,
    env: environment,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`[controlled acceptance] Unable to start check: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[controlled acceptance] FAILED: ${check.name}`);
    process.exit(result.status ?? 1);
  }
}

console.log(
  "\nControlled acceptance passed. Provider/identity/payment fixtures are mocked; this is not a live external-provider or browser journey.",
);
