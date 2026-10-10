#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const projectRoot = process.cwd();
const backupsDir = resolve(projectRoot, "backups");
mkdirSync(backupsDir, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const dbName = (() => {
  try {
    const url = new URL(databaseUrl);
    return url.pathname.replace(/^\//, "") || "ai_sdlc";
  } catch {
    return "ai_sdlc";
  }
})();

const outputPath = resolve(backupsDir, `${dbName}-${timestamp}.sql`);
const pgDump = spawnSync("pg_dump", [databaseUrl, "-f", outputPath], {
  stdio: "inherit",
  env: process.env,
});

if (pgDump.error) {
  console.error("pg_dump was not found or failed to start.");
  console.error(pgDump.error.message);
  process.exit(1);
}

if (pgDump.status !== 0) {
  console.error(`Backup failed with exit code ${pgDump.status}.`);
  process.exit(pgDump.status ?? 1);
}

console.log(`Backup created at ${outputPath}`);
