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
    throw new Error("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required to mint installation tokens");
  }

  const appJwt = signGitHubAppJwt(config.appId, config.privateKey);
  const baseUrl = config.baseUrl ?? "https://api.github.com";

  const response = await fetch(`${baseUrl}/app/installations/${githubInstallationId}/access_tokens`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${appJwt}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

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

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`GitHub API request failed (${response.status} ${init.method ?? "GET"} ${path}): ${body}`);
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
      }>
    >(githubInstallationId, `/repos/${owner}/${repo}/pulls/${pullNumber}/files?per_page=${perPage}&page=${page}`);

    files.push(...pageFiles);

    if (pageFiles.length < perPage) {
      break;
    }
    page += 1;
  }

  return files;
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
export async function getInstallationDetails(githubInstallationId: string): Promise<GitHubInstallationDetails> {
  const config = getGitHubAppConfig();
  if (!config.appId || !config.privateKey) {
    throw new Error("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required to fetch installation details");
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