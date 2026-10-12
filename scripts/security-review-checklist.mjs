#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const includeDatabaseTests = process.argv.includes("--with-database");
const envFile = resolve(repositoryRoot, ".env");

if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const codeChecks = [
  {
    name: "Build workspace runtime dependencies",
    args: [
      "--filter",
      "@ai-sdlc/db",
      "--filter",
      "@ai-sdlc/github",
      "--filter",
      "@ai-sdlc/risk",
      "--filter",
      "@ai-sdlc/policy",
      "--filter",
      "@ai-sdlc/provenance",
      "--filter",
      "@ai-sdlc/security",
      "-r",
      "build",
    ],
  },
  {
    name: "API webhook replay and secret redaction",
    args: [
      "--filter",
      "@ai-sdlc/api",
      "exec",
      "vitest",
      "run",
      "src/webhooks.test.ts",
      "src/security/redaction.test.ts",
    ],
  },
  {
    name: "Session, role, and audit integrity",
    args: [
      "--filter",
      "@ai-sdlc/db",
      "exec",
      "vitest",
      "run",
      "src/sessions.test.ts",
      "src/authorize.test.ts",
      "src/audit-integrity.test.ts",
    ],
  },
  {
    name: "Tenant access and retention query guards",
    args: [
      "--filter",
      "@ai-sdlc/db",
      "exec",
      "vitest",
      "run",
      "src/index.test.ts",
      "-t",
      "checks membership only when SCIM|rejects cross-tenant access|allows access when the user has the required role|rejects access when the user is below|calculates the retention cutoff|purges expired sessions|applies per-organization webhook retention|prunes only terminal webhook|rejects invalid organization retention",
    ],
  },
  {
    name: "GitHub webhook signature verification",
    args: ["--filter", "@ai-sdlc/github", "exec", "vitest", "run", "src/index.test.ts"],
  },
  {
    name: "Worker retention behavior",
    args: [
      "--filter",
      "@ai-sdlc/worker",
      "exec",
      "vitest",
      "run",
      "src/processors/retention.test.ts",
      "src/config.test.ts",
    ],
  },
  {
    name: "API and database typechecks",
    args: ["--filter", "@ai-sdlc/api", "--filter", "@ai-sdlc/db", "typecheck"],
  },
];

const databaseChecks = [
  {
    name: "API and tenant lifecycle integration",
    args: [
      "--filter",
      "@ai-sdlc/api",
      "exec",
      "vitest",
      "run",
      "src/app.test.ts",
      "src/tenant-isolation.test.ts",
      "src/tenant-lifecycle-isolation.test.ts",
    ],
  },
  {
    name: "Database service-account integration",
    args: [
      "--filter",
      "@ai-sdlc/db",
      "exec",
      "vitest",
      "run",
      "src/index.test.ts",
      "src/audit.test.ts",
    ],
  },
];

function runChecks(checks, env = process.env) {
  let failed = false;

  for (const check of checks) {
    console.log(`\n[security:review] ${check.name}`);
    const result = spawnSync("pnpm", check.args, {
      cwd: repositoryRoot,
      env,
      stdio: "inherit",
    });

    if (result.error) {
      console.error(`[security:review] Unable to start check: ${result.error.message}`);
      failed = true;
    } else if (result.status !== 0) {
      console.error(`[security:review] FAILED: ${check.name}`);
      failed = true;
    } else {
      console.log(`[security:review] PASSED: ${check.name}`);
    }
  }

  return failed;
}

console.log("Final adversarial security review: automated code checks");
const codeChecksFailed = runChecks(codeChecks);

if (includeDatabaseTests) {
  const databaseUrl = process.env["SECURITY_REVIEW_DATABASE_URL"];
  const redisUrl = process.env["SECURITY_REVIEW_REDIS_URL"];
  if (!databaseUrl || !redisUrl) {
    console.error(
      "\n[security:review] --with-database requires SECURITY_REVIEW_DATABASE_URL and SECURITY_REVIEW_REDIS_URL for isolated test services.",
    );
    process.exitCode = 2;
  } else {
    console.log(
      "\nRunning database-backed checks against explicitly configured isolated test services.",
    );
    const databaseCheckFailed = runChecks(databaseChecks, {
      ...process.env,
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl,
    });
    if (databaseCheckFailed) {
      process.exitCode = 1;
    }
  }
} else {
  console.log("\n[security:review] Database-backed route tests were not run.");
  console.log(
    "Run `pnpm security:review --with-database` after configuring a test database and Redis.",
  );
}

if (codeChecksFailed) {
  process.exitCode = 1;
}

console.log("\nManual release gates remain:");
console.log("- Verify live operational alerts/logging and capture sanitized review evidence.");
console.log("- Have the response team review the runbook and DR plan.");
console.log("- Assign an owner and remediation date for each accepted residual risk.");
