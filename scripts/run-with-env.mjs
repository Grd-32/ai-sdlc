#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = process.cwd();
const envPath = resolve(projectRoot, ".env");
const args = process.argv.slice(2);

if (args[0] === "--production") {
  process.env["NODE_ENV"] = "production";
  args.shift();
}

if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

if (args.length === 0) {
  console.error("Usage: run-with-env <command> [args...]");
  process.exit(1);
}

const [command, ...commandArgs] = args;
const result = spawnSync(command, commandArgs, {
  stdio: "inherit",
  shell: true,
  env: process.env,
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
