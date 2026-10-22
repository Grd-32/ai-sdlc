import { SourceControlProviderError } from "./index.js";

const AUTHORIZE_ENDPOINT = "https://bitbucket.org/site/oauth2/authorize";
const TOKEN_ENDPOINT = "https://bitbucket.org/site/oauth2/access_token";
const REVOKE_ENDPOINT = "https://bitbucket.org/site/oauth2/revoke";

export interface BitbucketOAuthToken {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scopes: string[];
}

interface OAuthOptions {
  clientId: string;
  clientSecret: string;
  fetchImplementation?: typeof fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getBitbucketAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}): URL {
  const url = new URL(AUTHORIZE_ENDPOINT);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  return url;
}

async function requestToken(
  form: URLSearchParams,
  options: OAuthOptions,
): Promise<BitbucketOAuthToken> {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  let response: Response;
  try {
    response = await fetchImplementation(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from(`${options.clientId}:${options.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
      redirect: "error",
    });
  } catch {
    throw new SourceControlProviderError("Bitbucket OAuth service is unavailable.", "UNAVAILABLE");
  }
  if (!response.ok) {
    throw new SourceControlProviderError(
      response.status === 400 || response.status === 401
        ? "Bitbucket OAuth authorization was rejected."
        : `Bitbucket OAuth request failed with status ${response.status}.`,
      response.status === 400 || response.status === 401
        ? "AUTHENTICATION"
        : response.status >= 500
          ? "UNAVAILABLE"
          : "INVALID_RESPONSE",
    );
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new SourceControlProviderError(
      "Bitbucket OAuth returned invalid JSON.",
      "INVALID_RESPONSE",
    );
  }
  if (
    !isRecord(value) ||
    typeof value["access_token"] !== "string" ||
    typeof value["refresh_token"] !== "string" ||
    typeof value["expires_in"] !== "number" ||
    !Number.isSafeInteger(value["expires_in"]) ||
    value["expires_in"] <= 0 ||
    typeof value["scopes"] !== "string"
  ) {
    throw new SourceControlProviderError(
      "Bitbucket OAuth returned an invalid token response.",
      "INVALID_RESPONSE",
    );
  }
  return {
    accessToken: value["access_token"],
    refreshToken: value["refresh_token"],
    expiresIn: value["expires_in"],
    scopes: value["scopes"].split(/\s+/).filter(Boolean),
  };
}

export function exchangeBitbucketOAuthCode(
  input: OAuthOptions & { code: string; redirectUri: string },
): Promise<BitbucketOAuthToken> {
  return requestToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
    }),
    input,
  );
}

export function refreshBitbucketOAuthToken(
  input: OAuthOptions & { refreshToken: string },
): Promise<BitbucketOAuthToken> {
  return requestToken(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
    }),
    input,
  );
}

export async function revokeBitbucketOAuthToken(
  input: OAuthOptions & { token: string },
): Promise<void> {
  const fetchImplementation = input.fetchImplementation ?? fetch;
  let response: Response;
  try {
    response = await fetchImplementation(REVOKE_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from(`${input.clientId}:${input.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ token: input.token }),
      redirect: "error",
    });
  } catch {
    throw new SourceControlProviderError(
      "Bitbucket token revocation is unavailable.",
      "UNAVAILABLE",
    );
  }
  if (!response.ok) {
    throw new SourceControlProviderError(
      `Bitbucket token revocation failed with status ${response.status}.`,
      response.status >= 500 ? "UNAVAILABLE" : "INVALID_RESPONSE",
    );
  }
}
