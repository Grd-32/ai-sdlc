import { SourceControlProviderError } from "./index.js";

const AUTHORITY = "https://login.microsoftonline.com";
const AZURE_DEVOPS_RESOURCE = "499b84ac-1321-427f-aa17-267ca6975798";

export interface AzureDevOpsOAuthToken {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string[];
}

interface OAuthOptions {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  fetchImplementation?: typeof fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tenantSegment(tenantId: string): string {
  if (!/^(common|organizations|[0-9a-f-]{36})$/i.test(tenantId)) {
    throw new SourceControlProviderError(
      "Azure tenant must be common, organizations, or a tenant GUID.",
      "INVALID_RESPONSE",
    );
  }
  return tenantId;
}

export function getAzureDevOpsAuthorizationUrl(input: {
  clientId: string;
  tenantId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): URL {
  const tenant = tenantSegment(input.tenantId);
  const url = new URL(`${AUTHORITY}/${tenant}/oauth2/v2.0/authorize`);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", `${AZURE_DEVOPS_RESOURCE}/.default offline_access`);
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url;
}

async function requestToken(
  form: URLSearchParams,
  options: OAuthOptions,
): Promise<AzureDevOpsOAuthToken> {
  const tenant = tenantSegment(options.tenantId);
  const fetchImplementation = options.fetchImplementation ?? fetch;
  let response: Response;
  try {
    response = await fetchImplementation(`${AUTHORITY}/${tenant}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      redirect: "error",
    });
  } catch {
    throw new SourceControlProviderError(
      "Microsoft Entra token service is unavailable.",
      "UNAVAILABLE",
    );
  }
  if (!response.ok) {
    throw new SourceControlProviderError(
      response.status === 400 || response.status === 401
        ? "Microsoft Entra authorization was rejected."
        : `Microsoft Entra token request failed with status ${response.status}.`,
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
      "Microsoft Entra returned invalid JSON.",
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
    typeof value["scope"] !== "string"
  ) {
    throw new SourceControlProviderError(
      "Microsoft Entra returned an invalid delegated token response.",
      "INVALID_RESPONSE",
    );
  }
  return {
    accessToken: value["access_token"],
    refreshToken: value["refresh_token"],
    expiresIn: value["expires_in"],
    scope: value["scope"].split(/\s+/).filter(Boolean),
  };
}

export function exchangeAzureDevOpsOAuthCode(
  input: OAuthOptions & {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  },
): Promise<AzureDevOpsOAuthToken> {
  return requestToken(
    new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
      scope: `${AZURE_DEVOPS_RESOURCE}/.default offline_access`,
    }),
    input,
  );
}

export function refreshAzureDevOpsOAuthToken(
  input: OAuthOptions & { refreshToken: string },
): Promise<AzureDevOpsOAuthToken> {
  return requestToken(
    new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
      scope: `${AZURE_DEVOPS_RESOURCE}/.default offline_access`,
    }),
    input,
  );
}
