// /**
//  * GitHub App API client.
//  *
//  * Phase 12: adds the pieces needed to actually call the GitHub REST API as
//  * the App — JWT app-level auth, installation access tokens, and a thin
//  * authenticated fetch wrapper — so the worker can list PR files and publish
//  * Check Runs.
//  *
//  * Deliberately dependency-free (raw `fetch` + `node:crypto`) rather than
//  * pulling in `jsonwebtoken` / `@octokit/*`. See README §94 rule 20 ("do not
//  * introduce a dependency without understanding why it is necessary") — App
//  * JWT signing is ~15 lines of RS256 over node:crypto, and the REST surface
//  * we need (installation tokens, PR files, check runs) is three endpoints.
//  * Revisit if the integration surface grows materially (pagination helpers,
//  * GraphQL, etc).
//  */

// import { createSign } from "node:crypto";
// import { getGitHubAppConfig } from "./index.js";

// function base64url(input: Buffer | string): string {
//   const buf = typeof input === "string" ? Buffer.from(input) : input;
//   return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
// }

// /**
//  * Sign a GitHub App JWT (RS256), per
//  * https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app
//  */
// export function signGitHubAppJwt(
//   appId: string,
//   privateKeyPem: string,
//   nowSeconds: number = Math.floor(Date.now() / 1000),
// ): string {
//   const header = { alg: "RS256", typ: "JWT" };
//   const payload = {
//     // Backdate by 60s to tolerate clock drift between this process and GitHub.
//     iat: nowSeconds - 60,
//     exp: nowSeconds + 9 * 60,
//     iss: appId,
//   };

//   const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;

//   const signer = createSign("RSA-SHA256");
//   signer.update(signingInput);
//   signer.end();

//   const signature = base64url(signer.sign(privateKeyPem));

//   return `${signingInput}.${signature}`;
// }

// interface CachedInstallationToken {
//   token: string;
//   expiresAt: number;
// }

// const installationTokenCache = new Map<string, CachedInstallationToken>();
// const TOKEN_REFRESH_SKEW_MS = 60_000;

// /** Exchange the App JWT for a short-lived, installation-scoped access token. Cached until near expiry. */
// export async function getInstallationAccessToken(githubInstallationId: string): Promise<string> {
//   const cached = installationTokenCache.get(githubInstallationId);
//   if (cached && cached.expiresAt - TOKEN_REFRESH_SKEW_MS > Date.now()) {
//     return cached.token;
//   }

//   const config = getGitHubAppConfig();
//   if (!config.appId || !config.privateKey) {
//     throw new Error("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required to mint installation tokens");
//   }

//   const appJwt = signGitHubAppJwt(config.appId, config.privateKey);
//   const baseUrl = config.baseUrl ?? "https://api.github.com";

//   const response = await fetch(`${baseUrl}/app/installations/${githubInstallationId}/access_tokens`, {
//     method: "POST",
//     headers: {
//       Authorization: `Bearer ${appJwt}`,
//       Accept: "application/vnd.github+json",
//       "X-GitHub-Api-Version": "2022-11-28",
//     },
//   });

//   if (!response.ok) {
//     const body = await response.text().catch(() => "");
//     throw new Error(`Failed to mint GitHub installation token (${response.status}): ${body}`);
//   }

//   const data = (await response.json()) as { token: string; expires_at: string };
//   const expiresAt = new Date(data.expires_at).getTime();

//   installationTokenCache.set(githubInstallationId, { token: data.token, expiresAt });

//   return data.token;
// }

// /** Test/ops helper — never trust cached tokens across test cases. */
// export function clearInstallationTokenCache(): void {
//   installationTokenCache.clear();
// }

// /** Installation-authenticated GitHub REST call. Never use a broad personal access token (README §46). */
// export async function githubApiRequest<T>(
//   githubInstallationId: string,
//   path: string,
//   init: RequestInit = {},
// ): Promise<T> {
//   const token = await getInstallationAccessToken(githubInstallationId);
//   const config = getGitHubAppConfig();
//   const baseUrl = config.baseUrl ?? "https://api.github.com";

//   const response = await fetch(`${baseUrl}${path}`, {
//     ...init,
//     headers: {
//       Authorization: `Bearer ${token}`,
//       Accept: "application/vnd.github+json",
//       "X-GitHub-Api-Version": "2022-11-28",
//       "Content-Type": "application/json",
//       ...(init.headers ?? {}),
//     },
//   });

//   if (!response.ok) {
//     const body = await response.text().catch(() => "");
//     throw new Error(`GitHub API request failed (${response.status} ${init.method ?? "GET"} ${path}): ${body}`);
//   }

//   if (response.status === 204) {
//     return undefined as T;
//   }

//   return (await response.json()) as T;
// }

// export interface GitHubPullRequestFile {
//   filename: string;
//   status: string;
//   additions: number;
//   deletions: number;
//   changes: number;
//   sha?: string;
// }

// /** List changed files for a PR, paginated. Treat repository content/paths as untrusted input downstream. */
// export async function listPullRequestFiles(
//   githubInstallationId: string,
//   owner: string,
//   repo: string,
//   pullNumber: number,
// ): Promise<GitHubPullRequestFile[]> {
//   const files: GitHubPullRequestFile[] = [];
//   const perPage = 100;
//   let page = 1;

//   // Safety cap: 2,000 changed files already indicates an extreme PR; stop rather than loop unbounded.
//   const MAX_PAGES = 20;

//   while (page <= MAX_PAGES) {
//     const pageFiles = await githubApiRequest<
//       Array<{
//         filename: string;
//         status: string;
//         additions: number;
//         deletions: number;
//         changes: number;
//         sha?: string;
//       }>
//     >(githubInstallationId, `/repos/${owner}/${repo}/pulls/${pullNumber}/files?per_page=${perPage}&page=${page}`);

//     files.push(...pageFiles);

//     if (pageFiles.length < perPage) {
//       break;
//     }
//     page += 1;
//   }

//   return files;
// }

// export const GITHUB_CLIENT_MODULE_VERSION = "0.1.0";
/**
 * GitHub App API client.
 *
 * Phase 12: adds the pieces needed to actually call the GitHub REST API as
 * the App — JWT app-level auth, installation access tokens, and a thin
 * authenticated fetch wrapper — so the worker can list PR files and publish
 * Check Runs.
 * Phase 14: adds getInstallationDetails — used by the installation setup-URL
 * callback to fetch account/permissions info right after a user completes
 * install, using the App's own JWT (not an installation token, since we
 * don't have one yet at that point).
 *
 * Deliberately dependency-free (raw `fetch` + `node:crypto`) rather than
 * pulling in `jsonwebtoken` / `@octokit/*`. See README §94 rule 20 ("do not
 * introduce a dependency without understanding why it is necessary") — App
 * JWT signing is ~15 lines of RS256 over node:crypto, and the REST surface
 * we need (installation tokens, PR files, check runs, installation details)
 * is four endpoints. Revisit if the integration surface grows materially
 * (pagination helpers, GraphQL, etc).
 */

import { createSign } from "node:crypto";
import { getGitHubAppConfig } from "./index.js";

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Sign a GitHub App JWT (RS256), per
 * https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app
 */
export function signGitHubAppJwt(
  appId: string,
  privateKeyPem: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    // Backdate by 60s to tolerate clock drift between this process and GitHub.
    iat: nowSeconds - 60,
    exp: nowSeconds + 9 * 60,
    iss: appId,
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;

  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();

  const signature = base64url(signer.sign(privateKeyPem));

  return `${signingInput}.${signature}`;
}

interface CachedInstallationToken {
  token: string;
  expiresAt: number;
}

const installationTokenCache = new Map<string, CachedInstallationToken>();
const TOKEN_REFRESH_SKEW_MS = 60_000;

/** Exchange the App JWT for a short-lived, installation-scoped access token. Cached until near expiry. */
export async function getInstallationAccessToken(githubInstallationId: string): Promise<string> {
  const cached = installationTokenCache.get(githubInstallationId);
  if (cached && cached.expiresAt - TOKEN_REFRESH_SKEW_MS > Date.now()) {
    return cached.token;
  }

  const config = getGitHubAppConfig();
  if (!config.appId || !config.privateKey) {
    throw new Error(
      "GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required to mint installation tokens",
    );
  }

  const appJwt = signGitHubAppJwt(config.appId, config.privateKey);
  const baseUrl = config.baseUrl ?? "https://api.github.com";

  const response = await fetch(
    `${baseUrl}/app/installations/${githubInstallationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${appJwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Failed to mint GitHub installation token (${response.status}): ${body}`);
  }

  const data = (await response.json()) as { token: string; expires_at: string };
  const expiresAt = new Date(data.expires_at).getTime();

  installationTokenCache.set(githubInstallationId, { token: data.token, expiresAt });

  return data.token;
}

/** Test/ops helper — never trust cached tokens across test cases. */
export function clearInstallationTokenCache(): void {
  installationTokenCache.clear();
}

/** Installation-authenticated GitHub REST call. Never use a broad personal access token (README §46). */
export async function githubApiRequest<T>(
  githubInstallationId: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await getInstallationAccessToken(githubInstallationId);
  const config = getGitHubAppConfig();
  const baseUrl = config.baseUrl ?? "https://api.github.com";
  const headers = new Headers({
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  });
  new Headers(init.headers).forEach((value, name) => {
    headers.set(name, value);
  });

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `GitHub API request failed (${response.status} ${init.method ?? "GET"} ${path}): ${body}`,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export interface GitHubPullRequestFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  sha?: string;
  patch?: string;
}

export interface GitHubPullRequestCommit {
  sha: string;
  commit: { message: string };
}

export interface GitHubPullRequestSummary {
  id: number;
  number: number;
  title: string;
  state: string;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  user: { login: string } | null;
  head: { sha: string; ref: string } | null;
  base: { ref: string } | null;
  additions: number;
  deletions: number;
  changed_files: number;
}

export interface GitHubPullRequestReview {
  id: number;
  user: { login: string } | null;
  state: string;
  submitted_at: string | null;
  commit_id: string | null;
}

export interface GitHubSecretScanningAlert {
  number: number;
  html_url: string;
  state: string;
  secret_type: string;
  secret_type_display_name: string;
  created_at: string;
  updated_at: string;
  resolution: string | null;
}

export interface GitHubCodeScanningAlert {
  number: number;
  html_url: string;
  state: string;
  title: string;
  severity: string | null;
  file: string | null;
  line: number | null;
}

export interface GitHubDependabotAlert {
  number: number;
  html_url: string;
  state: string;
  packageName: string;
  manifestPath: string | null;
  summary: string;
  severity: string | null;
  createdAt: string | null;
}

export type GitHubBranchProtection =
  | {
      status: "AVAILABLE";
      requiredApprovals: number;
      requiredChecks: string[];
      enforceAdmins: boolean;
    }
  | { status: "UNKNOWN"; reason: string };

export interface GitHubInstallationRepository {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string } | null;
  default_branch?: string | null;
  private?: boolean;
}

/** Reads bounded repository PR history. The caller applies its fixed time window. */
export async function listRepositoryPullRequests(
  githubInstallationId: string,
  owner: string,
  repo: string,
): Promise<GitHubPullRequestSummary[]> {
  const pullRequests: GitHubPullRequestSummary[] = [];
  const perPage = 100;
  const maxPages = 30;

  for (let page = 1; page <= maxPages; page += 1) {
    const pagePullRequests = await githubApiRequest<GitHubPullRequestSummary[]>(
      githubInstallationId,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=all&sort=updated&direction=desc&per_page=${perPage}&page=${page}`,
    );
    pullRequests.push(...pagePullRequests);

    if (pagePullRequests.length < perPage) {
      return pullRequests;
    }
  }

  throw new Error(
    `GitHub returned the maximum ${perPage * maxPages} pull requests for ${owner}/${repo}; refusing to claim complete history`,
  );
}

export async function listPullRequestReviews(
  githubInstallationId: string,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<GitHubPullRequestReview[]> {
  const reviews: GitHubPullRequestReview[] = [];
  const perPage = 100;
  const maxPages = 20;

  for (let page = 1; page <= maxPages; page += 1) {
    const pageReviews = await githubApiRequest<GitHubPullRequestReview[]>(
      githubInstallationId,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}/reviews?per_page=${perPage}&page=${page}`,
    );
    reviews.push(...pageReviews);
    if (pageReviews.length < perPage) {
      return reviews;
    }
  }

  throw new Error(
    `GitHub returned the maximum ${perPage * maxPages} reviews for ${owner}/${repo}#${pullNumber}; refusing incomplete review coverage`,
  );
}

/** Read open repository secret-scanning alerts without retaining the secret value. */
export async function listGitHubSecretScanningAlerts(
  githubInstallationId: string,
  owner: string,
  repo: string,
): Promise<GitHubSecretScanningAlert[]> {
  const alerts: GitHubSecretScanningAlert[] = [];
  const perPage = 100;
  const maxPages = 20;

  for (let page = 1; page <= maxPages; page += 1) {
    const pageAlerts = await githubApiRequest<GitHubSecretScanningAlert[]>(
      githubInstallationId,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/secret-scanning/alerts?state=open&per_page=${perPage}&page=${page}`,
    );
    alerts.push(
      ...pageAlerts.map((alert) => ({
        number: alert.number,
        html_url: alert.html_url,
        state: alert.state,
        secret_type: alert.secret_type,
        secret_type_display_name: alert.secret_type_display_name,
        created_at: alert.created_at,
        updated_at: alert.updated_at,
        resolution: alert.resolution,
      })),
    );
    if (pageAlerts.length < perPage) {
      return alerts;
    }
  }
  throw new Error(
    `GitHub returned the maximum ${perPage * maxPages} secret-scanning alerts for ${owner}/${repo}; refusing incomplete results`,
  );
}

/** Read bounded open Code Scanning alerts; alert payloads are reduced to report-safe fields. */
export async function listGitHubCodeScanningAlerts(
  githubInstallationId: string,
  owner: string,
  repo: string,
): Promise<GitHubCodeScanningAlert[]> {
  const alerts: GitHubCodeScanningAlert[] = [];
  const perPage = 100;
  const maxPages = 20;

  for (let page = 1; page <= maxPages; page += 1) {
    const pageAlerts = await githubApiRequest<
      Array<{
        number: number;
        html_url: string;
        state: string;
        rule?: { description?: string; name?: string; security_severity_level?: string };
        most_recent_instance?: {
          location?: { path?: string; start_line?: number };
        };
      }>
    >(
      githubInstallationId,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/code-scanning/alerts?state=open&per_page=${perPage}&page=${page}`,
    );
    alerts.push(
      ...pageAlerts.map((alert) => ({
        number: alert.number,
        html_url: alert.html_url,
        state: alert.state,
        title: alert.rule?.description ?? alert.rule?.name ?? "Code scanning alert",
        severity: alert.rule?.security_severity_level ?? null,
        file: alert.most_recent_instance?.location?.path ?? null,
        line: alert.most_recent_instance?.location?.start_line ?? null,
      })),
    );
    if (pageAlerts.length < perPage) return alerts;
  }
  throw new Error(
    `GitHub returned the maximum ${perPage * maxPages} Code Scanning alerts for ${owner}/${repo}; refusing incomplete results`,
  );
}

/** Read bounded open Dependabot alerts without retaining unnecessary advisory payload. */
export async function listGitHubDependabotAlerts(
  githubInstallationId: string,
  owner: string,
  repo: string,
): Promise<GitHubDependabotAlert[]> {
  const alerts: GitHubDependabotAlert[] = [];
  const perPage = 100;
  const maxPages = 20;

  for (let page = 1; page <= maxPages; page += 1) {
    const pageAlerts = await githubApiRequest<
      Array<{
        number: number;
        html_url: string;
        state: string;
        created_at?: string;
        dependency?: { package?: { name?: string }; manifest_path?: string };
        security_advisory?: { summary?: string; severity?: string };
        security_vulnerability?: { severity?: string };
      }>
    >(
      githubInstallationId,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/dependabot/alerts?state=open&per_page=${perPage}&page=${page}`,
    );
    alerts.push(
      ...pageAlerts.map((alert) => ({
        number: alert.number,
        html_url: alert.html_url,
        state: alert.state,
        packageName: alert.dependency?.package?.name ?? "Unknown package",
        manifestPath: alert.dependency?.manifest_path ?? null,
        summary: alert.security_advisory?.summary ?? "Dependency vulnerability",
        severity:
          alert.security_vulnerability?.severity ?? alert.security_advisory?.severity ?? null,
        createdAt: alert.created_at ?? null,
      })),
    );
    if (pageAlerts.length < perPage) return alerts;
  }
  throw new Error(
    `GitHub returned the maximum ${perPage * maxPages} Dependabot alerts for ${owner}/${repo}; refusing incomplete results`,
  );
}

export async function getGitHubBranchProtection(
  githubInstallationId: string,
  owner: string,
  repo: string,
  branch: string,
): Promise<GitHubBranchProtection> {
  const path =
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches/` +
    `${encodeURIComponent(branch)}/protection`;
  try {
    const protection = await githubApiRequest<{
      required_pull_request_reviews?: { required_approving_review_count?: number };
      required_status_checks?: { contexts?: string[]; checks?: Array<{ context?: string }> };
      enforce_admins?: { enabled?: boolean };
    }>(githubInstallationId, path);
    return {
      status: "AVAILABLE",
      requiredApprovals:
        protection.required_pull_request_reviews?.required_approving_review_count ?? 0,
      requiredChecks: [
        ...(protection.required_status_checks?.contexts ?? []),
        ...(protection.required_status_checks?.checks ?? [])
          .map((check) => check.context)
          .filter((context): context is string => Boolean(context)),
      ],
      enforceAdmins: protection.enforce_admins?.enabled ?? false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub request failed";
    if (/\(404\b/.test(message)) {
      return {
        status: "UNKNOWN",
        reason: "GitHub returned 404; branch protection may be absent or not visible to this App.",
      };
    }
    if (/\(403\b/.test(message)) {
      return {
        status: "UNKNOWN",
        reason:
          "The GitHub App cannot read branch-protection settings with its current permissions.",
      };
    }
    throw error;
  }
}

/** List every repository currently available to an installation, with a bounded pagination loop. */
export async function listInstallationRepositories(
  githubInstallationId: string,
): Promise<GitHubInstallationRepository[]> {
  const repositories: GitHubInstallationRepository[] = [];
  const perPage = 100;
  const maxPages = 100;

  for (let page = 1; page <= maxPages; page += 1) {
    const result = await githubApiRequest<{
      repositories: GitHubInstallationRepository[];
    }>(githubInstallationId, `/installation/repositories?per_page=${perPage}&page=${page}`);
    repositories.push(...result.repositories);

    if (result.repositories.length < perPage) {
      return repositories;
    }
  }

  throw new Error(
    `GitHub installation ${githubInstallationId} has more than ${perPage * maxPages} repositories; refusing an incomplete sync`,
  );
}

/** List changed files for a PR, paginated. Treat repository content/paths as untrusted input downstream. */
export async function listPullRequestFiles(
  githubInstallationId: string,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<GitHubPullRequestFile[]> {
  const files: GitHubPullRequestFile[] = [];
  const perPage = 100;
  let page = 1;

  // Safety cap: 2,000 changed files already indicates an extreme PR; stop rather than loop unbounded.
  const MAX_PAGES = 20;

  while (page <= MAX_PAGES) {
    const pageFiles = await githubApiRequest<
      Array<{
        filename: string;
        status: string;
        additions: number;
        deletions: number;
        changes: number;
        sha?: string;
        patch?: string;
      }>
    >(
      githubInstallationId,
      `/repos/${owner}/${repo}/pulls/${pullNumber}/files?per_page=${perPage}&page=${page}`,
    );

    files.push(...pageFiles);

    if (pageFiles.length < perPage) {
      break;
    }
    page += 1;
  }

  return files;
}

/** List PR commits so explicit AI provenance trailers can be checked without guessing from code. */
export async function listPullRequestCommits(
  githubInstallationId: string,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<GitHubPullRequestCommit[]> {
  const commits: GitHubPullRequestCommit[] = [];
  const perPage = 100;
  const maxPages = 20;

  for (let page = 1; page <= maxPages; page += 1) {
    const pageCommits = await githubApiRequest<GitHubPullRequestCommit[]>(
      githubInstallationId,
      `/repos/${owner}/${repo}/pulls/${pullNumber}/commits?per_page=${perPage}&page=${page}`,
    );
    commits.push(...pageCommits);

    if (pageCommits.length < perPage) {
      return commits;
    }
  }

  throw new Error(
    `Pull request ${owner}/${repo}#${pullNumber} has more than ${perPage * maxPages} commits; refusing incomplete provenance analysis`,
  );
}

export interface GitHubInstallationDetails {
  id: number;
  account: { login: string; type: string } | null;
  permissions: Record<string, string>;
}

/**
 * Fetch installation details using the App's own JWT — NOT an installation
 * token, since at the moment this is called (right after a user completes
 * install) we don't necessarily have one cached yet, and this specific
 * endpoint is app-level, not installation-scoped, per GitHub's API.
 */
export async function getInstallationDetails(
  githubInstallationId: string,
): Promise<GitHubInstallationDetails> {
  const config = getGitHubAppConfig();
  if (!config.appId || !config.privateKey) {
    throw new Error(
      "GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required to fetch installation details",
    );
  }

  const appJwt = signGitHubAppJwt(config.appId, config.privateKey);
  const baseUrl = config.baseUrl ?? "https://api.github.com";

  const response = await fetch(`${baseUrl}/app/installations/${githubInstallationId}`, {
    headers: {
      Authorization: `Bearer ${appJwt}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Failed to fetch installation details (${response.status}): ${body}`);
  }

  return (await response.json()) as GitHubInstallationDetails;
}

export const GITHUB_CLIENT_MODULE_VERSION = "0.1.0";
