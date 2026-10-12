#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: pnpm db:restore -- <path-to-backup.sql>");
  process.exit(1);
}

const psql = spawnSync("psql", [databaseUrl, "-f", inputPath], {
  stdio: "inherit",
  env: process.env,
});

if (psql.error) {
  console.error("psql was not found or failed to start.");
  console.error(psql.error.message);
  process.exit(1);
}

if (psql.status !== 0) {
  console.error(`Restore failed with exit code ${psql.status}.`);
  process.exit(psql.status ?? 1);
}

console.log(`Restore completed from ${inputPath}`);
