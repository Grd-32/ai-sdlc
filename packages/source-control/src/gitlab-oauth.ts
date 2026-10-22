import { SourceControlProviderError } from "./index.js";

const TOKEN_ENDPOINT = "https://gitlab.com/oauth/token";
const REVOKE_ENDPOINT = "https://gitlab.com/oauth/revoke";

export interface GitLabOAuthToken {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string[];
}

interface GitLabOAuthOptions {
  clientId: string;
  clientSecret: string;
  fetchImplementation?: typeof fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function requestOAuthToken(
  form: URLSearchParams,
  options: GitLabOAuthOptions,
): Promise<GitLabOAuthToken> {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  let response: Response;
  try {
    response = await fetchImplementation(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      redirect: "error",
    });
  } catch {
    throw new SourceControlProviderError("GitLab OAuth service is unavailable.", "UNAVAILABLE");
  }
  if (!response.ok) {
    throw new SourceControlProviderError(
      response.status === 401 || response.status === 400
        ? "GitLab OAuth authorization was rejected."
        : `GitLab OAuth request failed with status ${response.status}.`,
      response.status === 401 || response.status === 400
        ? "AUTHENTICATION"
        : response.status >= 500
          ? "UNAVAILABLE"
          : "INVALID_RESPONSE",
    );
  }
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new SourceControlProviderError("GitLab OAuth returned invalid JSON.", "INVALID_RESPONSE");
  }
  if (
    !isRecord(result) ||
    typeof result["access_token"] !== "string" ||
    typeof result["refresh_token"] !== "string" ||
    typeof result["expires_in"] !== "number" ||
    !Number.isSafeInteger(result["expires_in"]) ||
    result["expires_in"] <= 0 ||
    typeof result["scope"] !== "string"
  ) {
    throw new SourceControlProviderError(
      "GitLab OAuth returned an invalid token response.",
      "INVALID_RESPONSE",
    );
  }
  return {
    accessToken: result["access_token"],
    refreshToken: result["refresh_token"],
    expiresIn: result["expires_in"],
    scope: result["scope"].split(/\s+/).filter(Boolean),
  };
}

export async function exchangeGitLabOAuthCode(
  input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  } & GitLabOAuthOptions,
): Promise<GitLabOAuthToken> {
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    code_verifier: input.codeVerifier,
    redirect_uri: input.redirectUri,
  });
  return requestOAuthToken(form, input);
}

export async function refreshGitLabOAuthToken(
  input: GitLabOAuthOptions & { refreshToken: string },
): Promise<GitLabOAuthToken> {
  const form = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: input.clientId,
    client_secret: input.clientSecret,
    refresh_token: input.refreshToken,
  });
  return requestOAuthToken(form, input);
}

export async function revokeGitLabOAuthToken(
  input: GitLabOAuthOptions & { token: string },
): Promise<void> {
  const fetchImplementation = input.fetchImplementation ?? fetch;
  let response: Response;
  try {
    response = await fetchImplementation(REVOKE_ENDPOINT, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: input.clientId,
        client_secret: input.clientSecret,
        token: input.token,
      }),
      redirect: "error",
    });
  } catch {
    throw new SourceControlProviderError(
      "GitLab token revocation service is unavailable.",
      "UNAVAILABLE",
    );
  }
  if (!response.ok) {
    throw new SourceControlProviderError(
      `GitLab token revocation failed with status ${response.status}.`,
      response.status >= 500 ? "UNAVAILABLE" : "INVALID_RESPONSE",
    );
  }
}
