/**
 * GitHub App integration package.
 * Phase 2: secure app configuration, installation mapping, repository discovery scaffold,
 * and webhook signature verification for GitHub App events.
 * Phase 12: adds client.ts (App JWT / installation tokens / REST calls) and
 * checks.ts (Check Run publishing) — re-exported below.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const GITHUB_PACKAGE_VERSION = "0.1.0";

export type GitHubAppPermission = "read" | "write";

export interface GitHubAppConfig {
  appId?: string;
  clientId?: string;
  clientSecret?: string;
  privateKey?: string;
  webhookSecret?: string;
  baseUrl?: string;
}

export interface GitHubWebhookHeaders {
  "x-hub-signature-256"?: string;
  "x-github-event"?: string;
  "x-github-delivery"?: string;
}

export interface GitHubAppInstallation {
  id: string;
  appId?: string;
  accountLogin?: string;
  accountType?: string;
  permissions?: Record<string, GitHubAppPermission>;
  organizationId?: string;
  createdAt?: string;
}

export interface GitHubRepositorySummary {
  id: string;
  name: string;
  fullName: string;
  owner: string;
  provider: "GITHUB";
  enabled: boolean;
  organizationId: string;
  defaultBranch?: string;
  externalId?: string;
  metadata?: Record<string, unknown>;
}

export const MINIMUM_GITHUB_APP_PERMISSIONS = {
  metadata: "read",
  contents: "read",
  pull_requests: "read",
  issues: "read",
  checks: "read",
  repository_hooks: "read",
} as const satisfies Record<string, GitHubAppPermission>;

/**
 * Prefer GITHUB_APP_PRIVATE_KEY_BASE64 — a base64-encoded PEM has no
 * escaping ambiguity at all (no \n vs literal newline, no quoting rules
 * to get wrong across .env / docker-compose / different shells). Falls
 * back to the legacy \n-escaped GITHUB_APP_PRIVATE_KEY for compatibility.
 *
 * Generate the base64 value with:
 *   base64 -w0 path/to/your-private-key.pem
 * and set it in .env as:
 *   GITHUB_APP_PRIVATE_KEY_BASE64=<that output>
 */
function resolvePrivateKey(): string | undefined {
  const base64Key = process.env["GITHUB_APP_PRIVATE_KEY_BASE64"];
  if (base64Key) {
    return Buffer.from(base64Key, "base64").toString("utf8");
  }

  const rawKey = process.env["GITHUB_APP_PRIVATE_KEY"];
  return rawKey ? rawKey.replace(/\\n/g, "\n") : undefined;
}

export function getGitHubAppConfig(): GitHubAppConfig {
  return {
    appId: process.env["GITHUB_APP_ID"],
    clientId: process.env["GITHUB_APP_CLIENT_ID"],
    clientSecret: process.env["GITHUB_APP_CLIENT_SECRET"],
    privateKey: resolvePrivateKey(),
    webhookSecret: process.env["GITHUB_WEBHOOK_SECRET"],
    baseUrl: process.env["GITHUB_APP_BASE_URL"] ?? "https://api.github.com",
  };
}

export function requireGitHubWebhookSecret(): string {
  const secret = getGitHubAppConfig().webhookSecret;
  if (!secret || secret.trim().length === 0) {
    throw new Error("GITHUB_WEBHOOK_SECRET is required for GitHub webhook verification");
  }
  return secret;
}

export function computeGitHubWebhookSignature(payload: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(payload, "utf8").digest("hex")}`;
}

export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  if (!payload || !signature || !secret) {
    return false;
  }

  const expected = computeGitHubWebhookSignature(payload, secret);
  const provided = signature.trim();

  if (provided.length !== expected.length) {
    return false;
  }

  try {
    return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(provided, "utf8"));
  } catch {
    return false;
  }
}

export function mapInstallationToOrganization(
  installationId: string,
  organizationId: string,
  install: Partial<GitHubAppInstallation> = {},
): GitHubAppInstallation {
  if (!installationId || installationId.trim().length === 0) {
    throw new Error("installationId is required");
  }
  if (!organizationId || organizationId.trim().length === 0) {
    throw new Error("organizationId is required");
  }

  return {
    id: installationId,
    appId: install.appId,
    accountLogin: install.accountLogin,
    accountType: install.accountType,
    permissions: install.permissions,
    organizationId,
    createdAt: install.createdAt ?? new Date().toISOString(),
  };
}

export function normalizeRepositoryDiscovery(
  repository: {
    id?: string | number;
    name?: string;
    full_name?: string;
    owner?: { login?: string } | null;
    default_branch?: string;
    private?: boolean;
    [key: string]: unknown;
  },
  organizationId: string,
): GitHubRepositorySummary {
  if (!repository.name) {
    throw new Error("Repository name is required");
  }
  if (!organizationId || organizationId.trim().length === 0) {
    throw new Error("organizationId is required");
  }

  const normalizedOwner = repository.owner?.login ?? "unknown";
  const fullName = repository.full_name ?? `${normalizedOwner}/${repository.name}`;

  return {
    id: String(repository.id ?? `${fullName}:${Date.now()}`),
    name: repository.name,
    fullName,
    owner: normalizedOwner,
    provider: "GITHUB",
    enabled: true,
    organizationId,
    defaultBranch: repository.default_branch,
    externalId: repository.id ? String(repository.id) : undefined,
    metadata: {
      private: repository.private === true,
      source: "github_app_discovery",
    },
  };
}

export function isGitHubRepositoryEnabled(enabled: boolean | undefined): boolean {
  return enabled === true;
}

// Phase 12
export * from "./client.js";
export * from "./checks.js";