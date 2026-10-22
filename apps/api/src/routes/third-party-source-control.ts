import { createHash, randomBytes } from "node:crypto";
import type { Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { ensureOrganizationAccess, prisma, recordAuditEvent, type Prisma } from "@ai-sdlc/db";
import { resolveOrganizationEntitlements } from "@ai-sdlc/billing";
import {
  AzureDevOpsClient,
  BitbucketClient,
  decryptSourceControlCredentials,
  encryptSourceControlSecret,
  encryptSourceControlCredentials,
  exchangeAzureDevOpsOAuthCode,
  exchangeBitbucketOAuthCode,
  getAzureDevOpsAuthorizationUrl,
  getBitbucketAuthorizationUrl,
  refreshAzureDevOpsOAuthToken,
  refreshBitbucketOAuthToken,
  revokeBitbucketOAuthToken,
  SourceControlProviderError,
  validateSourceControlEncryptionKey,
} from "@ai-sdlc/source-control";
import { requireAuth, requireOrganizationRole } from "../middleware/auth.js";
import { readJsonObject } from "../request-body.js";
import { SESSION_COOKIE, verifySessionCookieValue } from "../auth/session.js";
import type { AppEnv } from "../types.js";

type ConnectProvider = "BITBUCKET" | "AZURE_DEVOPS";
type ProviderConnection = {
  id: string;
  organizationId: string;
  provider: string;
  externalAccountId: string;
  accountName: string;
  credentialCiphertext: string;
  scopes: string[];
  active: boolean;
};

const CALLBACK_PATH: Record<ConnectProvider, string> = {
  BITBUCKET: "/api/auth/bitbucket/callback",
  AZURE_DEVOPS: "/api/auth/azure-devops/callback",
};
const COOKIE_NAMES: Record<
  ConnectProvider,
  { state: string; verifier: string; org: string; target: string }
> = {
  BITBUCKET: {
    state: "nomalog_bitbucket_state",
    verifier: "nomalog_bitbucket_verifier",
    org: "nomalog_bitbucket_org",
    target: "nomalog_bitbucket_target",
  },
  AZURE_DEVOPS: {
    state: "nomalog_azure_devops_state",
    verifier: "nomalog_azure_devops_verifier",
    org: "nomalog_azure_devops_org",
    target: "nomalog_azure_devops_target",
  },
};

function appOrigin(): string {
  const configured = process.env["APP_URL"];
  if (!configured) throw new Error("APP_URL must be configured for source-control OAuth.");
  const url = new URL(configured);
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new Error("APP_URL must use HTTPS for source-control OAuth.");
  }
  return url.origin;
}

function oauthConfig(provider: ConnectProvider): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tenantId?: string;
} {
  const prefix = provider === "BITBUCKET" ? "BITBUCKET" : "AZURE_DEVOPS";
  const clientId = process.env[`${prefix}_OAUTH_CLIENT_ID`];
  const clientSecret = process.env[`${prefix}_OAUTH_CLIENT_SECRET`];
  if (!clientId || !clientSecret) {
    throw new Error(`${prefix}_OAUTH_CLIENT_ID and ${prefix}_OAUTH_CLIENT_SECRET are required.`);
  }
  const redirectUri =
    process.env[`${prefix}_OAUTH_CALLBACK_URL`] ??
    new URL(CALLBACK_PATH[provider], appOrigin()).toString();
  const callback = new URL(redirectUri);
  if (
    callback.origin !== appOrigin() ||
    callback.pathname !== CALLBACK_PATH[provider] ||
    callback.username ||
    callback.password ||
    callback.search ||
    callback.hash
  ) {
    throw new Error(`${prefix}_OAUTH_CALLBACK_URL must match its same-origin callback route.`);
  }
  if (provider === "AZURE_DEVOPS") {
    const tenantId = process.env["AZURE_DEVOPS_TENANT_ID"] ?? "organizations";
    return { clientId, clientSecret, redirectUri, tenantId };
  }
  return { clientId, clientSecret, redirectUri };
}

function cookieOptions(origin: string) {
  return {
    httpOnly: true,
    secure: origin.startsWith("https://"),
    sameSite: "Lax" as const,
    path: "/api",
    maxAge: 600,
  };
}

function clearCookies(c: Context<AppEnv>, provider: ConnectProvider, origin: string): void {
  const options = cookieOptions(origin);
  for (const name of Object.values(COOKIE_NAMES[provider])) deleteCookie(c, name, options);
}

function errorRedirect(provider: ConnectProvider, origin: string, code: string): string {
  const url = new URL("/dashboard/repositories", origin);
  url.searchParams.set(provider === "BITBUCKET" ? "bitbucketError" : "azureDevOpsError", code);
  return url.toString();
}

function requiredBitbucketScopes(scopes: string[]): void {
  const required = ["account", "repository", "pullrequest"];
  if (required.some((scope) => !scopes.includes(scope))) {
    throw new SourceControlProviderError(
      "Bitbucket authorization is missing account, repository, or pull-request read scopes.",
      "PERMISSION",
    );
  }
}

function requiredAzureDevOpsScopes(scopes: string[]): void {
  const granted = new Set(scopes.map((scope) => scope.toLowerCase()));
  const required = ["vso.code", "vso.project"];
  const supported = [...required, "vso.advsec"];
  if (
    required.some((scope) => !granted.has(scope)) ||
    [...granted].some((scope) => scope.startsWith("vso.") && !supported.includes(scope))
  ) {
    throw new SourceControlProviderError(
      "Azure DevOps authorization requires vso.code and vso.project read scopes; vso.advsec enables Advanced Security alerts.",
      "PERMISSION",
    );
  }
}

function providerErrorResponse(error: unknown, provider: ConnectProvider) {
  if (!(error instanceof SourceControlProviderError)) {
    console.error(`[source-control.${provider.toLowerCase()}] operation failed`, {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return {
      status: 502 as const,
      error: {
        code: `${provider}_UNAVAILABLE`,
        message: `${provider === "BITBUCKET" ? "Bitbucket Cloud" : "Azure DevOps"} could not complete the request.`,
      },
    };
  }
  const status: 400 | 401 | 403 | 429 | 502 =
    error.kind === "AUTHENTICATION"
      ? 401
      : error.kind === "PERMISSION"
        ? 403
        : error.kind === "RATE_LIMITED"
          ? 429
          : error.kind === "INVALID_RESPONSE"
            ? 400
            : 502;
  return { status, error: { code: `${provider}_${error.kind}`, message: error.message } };
}

function assertConnection(
  connection: ProviderConnection | null,
  organizationId: string,
  provider: ConnectProvider,
): asserts connection is ProviderConnection {
  if (
    !connection ||
    !connection.active ||
    connection.organizationId !== organizationId ||
    connection.provider !== provider
  ) {
    throw new SourceControlProviderError(
      `Active ${provider} connection not found for this organization.`,
      "AUTHENTICATION",
    );
  }
}

async function getConnectionToken(
  connection: ProviderConnection,
  provider: ConnectProvider,
): Promise<string> {
  if (!connection.active) {
    throw new SourceControlProviderError(
      "Source-control connection is inactive.",
      "AUTHENTICATION",
    );
  }
  let credentials = decryptSourceControlCredentials(connection.credentialCiphertext);
  if (Date.parse(credentials.expiresAt) > Date.now() + 5 * 60 * 1000) {
    return credentials.accessToken;
  }
  const prefix = provider === "BITBUCKET" ? "BITBUCKET" : "AZURE_DEVOPS";
  const clientId = process.env[`${prefix}_OAUTH_CLIENT_ID`];
  const clientSecret = process.env[`${prefix}_OAUTH_CLIENT_SECRET`];
  if (!clientId || !clientSecret) {
    throw new SourceControlProviderError(
      `${prefix} OAuth token refresh is not configured.`,
      "UNAVAILABLE",
    );
  }
  const config = provider === "AZURE_DEVOPS" ? oauthConfig("AZURE_DEVOPS") : null;
  if (provider === "BITBUCKET") {
    const refreshed = await refreshBitbucketOAuthToken({
      clientId,
      clientSecret,
      refreshToken: credentials.refreshToken,
    });
    requiredBitbucketScopes(refreshed.scopes);
    const next = {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      expiresAt: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString(),
    };
    const updated = await prisma.sourceControlConnection.updateMany({
      where: {
        id: connection.id,
        organizationId: connection.organizationId,
        provider,
        active: true,
        credentialCiphertext: connection.credentialCiphertext,
      },
      data: {
        credentialCiphertext: encryptSourceControlCredentials(next),
        scopes: refreshed.scopes,
      },
    });
    if (updated.count === 1) return next.accessToken;
    const latest = await prisma.sourceControlConnection.findFirst({
      where: {
        id: connection.id,
        organizationId: connection.organizationId,
        provider,
        active: true,
      },
      select: { credentialCiphertext: true },
    });
    if (!latest) {
      throw new SourceControlProviderError(
        "Source-control connection was disconnected during token refresh.",
        "AUTHENTICATION",
      );
    }
    const latestCredentials = decryptSourceControlCredentials(latest.credentialCiphertext);
    if (Date.parse(latestCredentials.expiresAt) <= Date.now()) {
      throw new SourceControlProviderError(
        "Token refresh did not produce an active token.",
        "AUTHENTICATION",
      );
    }
    return latestCredentials.accessToken;
  }

  const refreshed = await refreshAzureDevOpsOAuthToken({
    clientId,
    clientSecret,
    tenantId: config?.tenantId ?? "organizations",
    refreshToken: credentials.refreshToken,
  });
  requiredAzureDevOpsScopes(refreshed.scope);
  const next = {
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    expiresAt: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString(),
  };
  const updated = await prisma.sourceControlConnection.updateMany({
    where: {
      id: connection.id,
      organizationId: connection.organizationId,
      provider,
      active: true,
      credentialCiphertext: connection.credentialCiphertext,
    },
    data: {
      credentialCiphertext: encryptSourceControlCredentials(next),
      scopes: refreshed.scope,
    },
  });
  if (updated.count === 1) {
    credentials = next;
  } else {
    const latest = await prisma.sourceControlConnection.findFirst({
      where: {
        id: connection.id,
        organizationId: connection.organizationId,
        provider,
        active: true,
      },
      select: { credentialCiphertext: true },
    });
    if (!latest) {
      throw new SourceControlProviderError(
        "Source-control connection was disconnected during token refresh.",
        "AUTHENTICATION",
      );
    }
    credentials = decryptSourceControlCredentials(latest.credentialCiphertext);
    if (Date.parse(credentials.expiresAt) <= Date.now()) {
      throw new SourceControlProviderError(
        "Token refresh did not produce an active token.",
        "AUTHENTICATION",
      );
    }
  }
  return credentials.accessToken;
}

async function connectionForOrganization(
  organizationId: string,
  connectionId: string,
  provider: ConnectProvider,
): Promise<ProviderConnection | null> {
  return prisma.sourceControlConnection.findFirst({
    where: { id: connectionId, organizationId, provider, active: true },
  });
}

async function saveRepositories(
  organizationId: string,
  connectionId: string,
  provider: ConnectProvider,
  selected: Array<{
    externalId: string;
    owner: string;
    name: string;
    defaultBranch: string | null;
    webUrl: string;
    original: unknown;
  }>,
): Promise<Array<{ id: string; owner: string; name: string; provider: string }>> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId})) IS NULL AS locked`;
    const entitlements = await resolveOrganizationEntitlements(organizationId, tx);
    const existing = await tx.repository.findMany({
      where: { organizationId, enabled: true },
      select: { provider: true, externalId: true },
    });
    const selectedIds = new Set(selected.map((repo) => repo.externalId));
    const existingIds = new Set(
      existing
        .filter((repo) => repo.provider === provider)
        .map((repo) => repo.externalId)
        .filter((id): id is string => id !== null),
    );
    const additions = [...selectedIds].filter((id) => !existingIds.has(id)).length;
    if (existing.length + additions > entitlements.entitlements.maxRepositories) {
      throw new Error("REPOSITORY_LIMIT_REACHED");
    }
    const saved = [];
    for (const repository of selected) {
      saved.push(
        await tx.repository.upsert({
          where: {
            organizationId_provider_owner_name: {
              organizationId,
              provider,
              owner: repository.owner,
              name: repository.name,
            },
          },
          create: {
            organizationId,
            provider,
            sourceControlConnectionId: connectionId,
            externalId: repository.externalId,
            owner: repository.owner,
            name: repository.name,
            defaultBranch: repository.defaultBranch,
            enabled: true,
            metadata: {
              webUrl: repository.webUrl,
              providerEvidence: repository.original,
            } as unknown as Prisma.InputJsonValue,
          },
          update: {
            sourceControlConnectionId: connectionId,
            externalId: repository.externalId,
            defaultBranch: repository.defaultBranch,
            enabled: true,
            metadata: {
              webUrl: repository.webUrl,
              providerEvidence: repository.original,
            } as unknown as Prisma.InputJsonValue,
          },
          select: { id: true, owner: true, name: true, provider: true },
        }),
      );
    }
    return saved;
  });
}

function checkSelectionBody(body: Record<string, unknown> | null): {
  connectionId: string;
  workspace?: string;
  project?: string;
  repositoryIds: string[];
} | null {
  if (
    !body ||
    typeof body["connectionId"] !== "string" ||
    body["connectionId"].length < 1 ||
    body["connectionId"].length > 128 ||
    !Array.isArray(body["repositoryIds"]) ||
    body["repositoryIds"].length < 1 ||
    body["repositoryIds"].length > 100 ||
    body["repositoryIds"].some((id) => typeof id !== "string" || id.length > 256) ||
    new Set(body["repositoryIds"]).size !== body["repositoryIds"].length
  ) {
    return null;
  }
  if (
    body["workspace"] !== undefined &&
    (typeof body["workspace"] !== "string" ||
      body["workspace"].length < 1 ||
      body["workspace"].length > 128)
  ) {
    return null;
  }
  if (
    body["project"] !== undefined &&
    (typeof body["project"] !== "string" ||
      body["project"].length < 1 ||
      body["project"].length > 256)
  ) {
    return null;
  }
  return {
    connectionId: body["connectionId"],
    workspace: typeof body["workspace"] === "string" ? body["workspace"] : undefined,
    project: typeof body["project"] === "string" ? body["project"] : undefined,
    repositoryIds: body["repositoryIds"] as string[],
  };
}

export function registerThirdPartySourceControlRoutes(app: Hono<AppEnv>): void {
  app.get("/api/source-control/bitbucket/connect", async (c) => {
    let origin: string;
    try {
      origin = appOrigin();
    } catch {
      return c.text("Bitbucket OAuth callback URL is not configured.", 503);
    }
    const organizationId = c.req.query("organizationId");
    const session = await verifySessionCookieValue(getCookie(c, SESSION_COOKIE));
    if (!session) {
      const returnTo = organizationId
        ? `/api/source-control/bitbucket/connect?organizationId=${encodeURIComponent(organizationId)}`
        : "/dashboard/repositories";
      return c.redirect(`/api/auth/github/login?redirectTo=${encodeURIComponent(returnTo)}`);
    }
    if (!organizationId)
      return c.redirect(errorRedirect("BITBUCKET", origin, "missing_organization"));
    try {
      await ensureOrganizationAccess({
        prisma,
        userId: session.userId,
        organizationId,
        minimumRole: "ADMIN",
      });
      const config = oauthConfig("BITBUCKET");
      validateSourceControlEncryptionKey();
      const state = randomBytes(32).toString("base64url");
      setCookie(c, COOKIE_NAMES.BITBUCKET.state, state, cookieOptions(origin));
      setCookie(c, COOKIE_NAMES.BITBUCKET.org, organizationId, cookieOptions(origin));
      return c.redirect(
        getBitbucketAuthorizationUrl({
          clientId: config.clientId,
          redirectUri: config.redirectUri,
          state,
        }).toString(),
      );
    } catch (error) {
      return c.redirect(
        errorRedirect(
          "BITBUCKET",
          origin,
          error instanceof Error && error.message.includes("required")
            ? "not_configured"
            : "forbidden",
        ),
      );
    }
  });

  app.get("/api/auth/bitbucket/callback", async (c) => {
    let origin: string;
    try {
      origin = appOrigin();
    } catch {
      return c.text("Bitbucket OAuth callback URL is not configured.", 503);
    }
    const session = await verifySessionCookieValue(getCookie(c, SESSION_COOKIE));
    if (!session) {
      return c.redirect(
        `/api/auth/github/login?redirectTo=${encodeURIComponent(`/api/auth/bitbucket/callback${new URL(c.req.url).search}`)}`,
      );
    }
    const state = c.req.query("state");
    const expectedState = getCookie(c, COOKIE_NAMES.BITBUCKET.state);
    const organizationId = getCookie(c, COOKIE_NAMES.BITBUCKET.org);
    clearCookies(c, "BITBUCKET", origin);
    if (c.req.query("error"))
      return c.redirect(errorRedirect("BITBUCKET", origin, "authorization_denied"));
    if (!state || state !== expectedState || !organizationId || !c.req.query("code")) {
      return c.redirect(errorRedirect("BITBUCKET", origin, "invalid_oauth_state"));
    }
    try {
      await ensureOrganizationAccess({
        prisma,
        userId: session.userId,
        organizationId,
        minimumRole: "ADMIN",
      });
      const config = oauthConfig("BITBUCKET");
      const code = c.req.query("code");
      if (!code) return c.redirect(errorRedirect("BITBUCKET", origin, "missing_code"));
      const token = await exchangeBitbucketOAuthCode({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        code,
        redirectUri: config.redirectUri,
      });
      requiredBitbucketScopes(token.scopes);
      const client = new BitbucketClient({ accessToken: token.accessToken });
      const profile = await client.getCurrentUser();
      const credentialCiphertext = encryptSourceControlCredentials({
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        expiresAt: new Date(Date.now() + token.expiresIn * 1000).toISOString(),
      });
      await prisma.sourceControlConnection.upsert({
        where: {
          organizationId_provider_externalAccountId: {
            organizationId,
            provider: "BITBUCKET",
            externalAccountId: profile.uuid,
          },
        },
        create: {
          organizationId,
          provider: "BITBUCKET",
          externalAccountId: profile.uuid,
          accountName: profile.username,
          credentialCiphertext,
          scopes: token.scopes,
          capabilities: { provider: "BITBUCKET" },
          active: true,
        },
        update: {
          accountName: profile.username,
          credentialCiphertext,
          scopes: token.scopes,
          active: true,
          revokedAt: null,
        },
      });
      await recordAuditEvent({
        organizationId,
        actorId: session.userId,
        eventType: "BITBUCKET_SOURCE_CONTROL_CONNECTED",
        metadata: { provider: "BITBUCKET", accountName: profile.username },
      });
      return c.redirect(`${origin}/dashboard/repositories?bitbucketConnected=1`);
    } catch (error) {
      const result = providerErrorResponse(error, "BITBUCKET");
      console.error("[source-control.bitbucket.oauth] connection failed", {
        category: result.error.code,
      });
      return c.redirect(errorRedirect("BITBUCKET", origin, result.error.code.toLowerCase()));
    }
  });

  app.get("/api/source-control/azure-devops/connect", async (c) => {
    let origin: string;
    try {
      origin = appOrigin();
    } catch {
      return c.text("Azure DevOps OAuth callback URL is not configured.", 503);
    }
    const organizationId = c.req.query("organizationId");
    const azureOrganization = c.req.query("azureOrganization")?.trim();
    const session = await verifySessionCookieValue(getCookie(c, SESSION_COOKIE));
    if (!session) {
      const query = new URLSearchParams({ organizationId: organizationId ?? "" });
      if (azureOrganization) query.set("azureOrganization", azureOrganization);
      return c.redirect(
        `/api/auth/github/login?redirectTo=${encodeURIComponent(`/api/source-control/azure-devops/connect?${query.toString()}`)}`,
      );
    }
    if (!organizationId || !azureOrganization || !/^[A-Za-z0-9_-]{1,64}$/.test(azureOrganization)) {
      return c.redirect(errorRedirect("AZURE_DEVOPS", origin, "invalid_organization"));
    }
    try {
      await ensureOrganizationAccess({
        prisma,
        userId: session.userId,
        organizationId,
        minimumRole: "ADMIN",
      });
      const config = oauthConfig("AZURE_DEVOPS");
      validateSourceControlEncryptionKey();
      const state = randomBytes(32).toString("base64url");
      const verifier = randomBytes(32).toString("base64url");
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      setCookie(c, COOKIE_NAMES.AZURE_DEVOPS.state, state, cookieOptions(origin));
      setCookie(c, COOKIE_NAMES.AZURE_DEVOPS.verifier, verifier, cookieOptions(origin));
      setCookie(c, COOKIE_NAMES.AZURE_DEVOPS.org, organizationId, cookieOptions(origin));
      setCookie(c, COOKIE_NAMES.AZURE_DEVOPS.target, azureOrganization, cookieOptions(origin));
      return c.redirect(
        getAzureDevOpsAuthorizationUrl({
          clientId: config.clientId,
          tenantId: config.tenantId ?? "organizations",
          redirectUri: config.redirectUri,
          state,
          codeChallenge: challenge,
        }).toString(),
      );
    } catch (error) {
      return c.redirect(
        errorRedirect(
          "AZURE_DEVOPS",
          origin,
          error instanceof Error && error.message.includes("required")
            ? "not_configured"
            : "forbidden",
        ),
      );
    }
  });

  app.get("/api/auth/azure-devops/callback", async (c) => {
    let origin: string;
    try {
      origin = appOrigin();
    } catch {
      return c.text("Azure DevOps OAuth callback URL is not configured.", 503);
    }
    const session = await verifySessionCookieValue(getCookie(c, SESSION_COOKIE));
    if (!session) {
      return c.redirect(
        `/api/auth/github/login?redirectTo=${encodeURIComponent(`/api/auth/azure-devops/callback${new URL(c.req.url).search}`)}`,
      );
    }
    const state = c.req.query("state");
    const expectedState = getCookie(c, COOKIE_NAMES.AZURE_DEVOPS.state);
    const verifier = getCookie(c, COOKIE_NAMES.AZURE_DEVOPS.verifier);
    const organizationId = getCookie(c, COOKIE_NAMES.AZURE_DEVOPS.org);
    const azureOrganization = getCookie(c, COOKIE_NAMES.AZURE_DEVOPS.target);
    clearCookies(c, "AZURE_DEVOPS", origin);
    if (c.req.query("error"))
      return c.redirect(errorRedirect("AZURE_DEVOPS", origin, "authorization_denied"));
    if (
      !state ||
      state !== expectedState ||
      !verifier ||
      !organizationId ||
      !azureOrganization ||
      !c.req.query("code")
    ) {
      return c.redirect(errorRedirect("AZURE_DEVOPS", origin, "invalid_oauth_state"));
    }
    try {
      await ensureOrganizationAccess({
        prisma,
        userId: session.userId,
        organizationId,
        minimumRole: "ADMIN",
      });
      const config = oauthConfig("AZURE_DEVOPS");
      const code = c.req.query("code");
      if (!code) return c.redirect(errorRedirect("AZURE_DEVOPS", origin, "missing_code"));
      const token = await exchangeAzureDevOpsOAuthCode({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        tenantId: config.tenantId ?? "organizations",
        code,
        codeVerifier: verifier,
        redirectUri: config.redirectUri,
      });
      requiredAzureDevOpsScopes(token.scope);
      const client = new AzureDevOpsClient({
        accessToken: token.accessToken,
        organization: azureOrganization,
      });
      const projects = await client.listProjects();
      const credentialCiphertext = encryptSourceControlCredentials({
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        expiresAt: new Date(Date.now() + token.expiresIn * 1000).toISOString(),
      });
      const externalAccountId = azureOrganization.toLowerCase();
      await prisma.sourceControlConnection.upsert({
        where: {
          organizationId_provider_externalAccountId: {
            organizationId,
            provider: "AZURE_DEVOPS",
            externalAccountId,
          },
        },
        create: {
          organizationId,
          provider: "AZURE_DEVOPS",
          externalAccountId,
          accountName: azureOrganization,
          credentialCiphertext,
          scopes: token.scope,
          capabilities: {
            provider: "AZURE_DEVOPS",
            projects: projects.items.length,
            complete: projects.complete,
          },
          active: true,
        },
        update: {
          accountName: azureOrganization,
          credentialCiphertext,
          scopes: token.scope,
          capabilities: {
            provider: "AZURE_DEVOPS",
            projects: projects.items.length,
            complete: projects.complete,
          },
          active: true,
          revokedAt: null,
        },
      });
      await recordAuditEvent({
        organizationId,
        actorId: session.userId,
        eventType: "AZURE_DEVOPS_SOURCE_CONTROL_CONNECTED",
        metadata: { provider: "AZURE_DEVOPS", accountName: azureOrganization },
      });
      return c.redirect(`${origin}/dashboard/repositories?azureDevOpsConnected=1`);
    } catch (error) {
      const result = providerErrorResponse(error, "AZURE_DEVOPS");
      console.error("[source-control.azure-devops.oauth] connection failed", {
        category: result.error.code,
      });
      return c.redirect(errorRedirect("AZURE_DEVOPS", origin, result.error.code.toLowerCase()));
    }
  });

  app.post(
    "/api/organizations/:organizationId/source-control/bitbucket/webhook-secret",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const body = await readJsonObject(c);
      const connectionId = body?.["connectionId"];
      if (typeof connectionId !== "string" || connectionId.length > 128) {
        return c.json(
          {
            data: null,
            error: { code: "INVALID_CONNECTION", message: "A valid connectionId is required." },
          },
          400,
        );
      }
      validateSourceControlEncryptionKey();
      const secret = randomBytes(32).toString("base64url");
      const result = await prisma.sourceControlConnection.updateMany({
        where: {
          id: connectionId,
          organizationId,
          provider: "BITBUCKET",
          active: true,
        },
        data: {
          webhookSecretCiphertext: encryptSourceControlSecret(secret),
          webhookSecretHash: null,
        },
      });
      if (result.count !== 1) {
        return c.json(
          {
            data: null,
            error: {
              code: "CONNECTION_NOT_FOUND",
              message: "Active Bitbucket connection not found.",
            },
          },
          404,
        );
      }
      const webhookUrl = new URL(
        `/api/webhooks/bitbucket/${encodeURIComponent(connectionId)}`,
        appOrigin(),
      ).toString();
      await recordAuditEvent({
        organizationId,
        actorId: c.get("userId"),
        eventType: "BITBUCKET_WEBHOOK_SECRET_ROTATED",
        metadata: { connectionId },
      });
      return c.json(
        {
          data: {
            webhookUrl,
            secret,
            events: ["pullrequest:created", "pullrequest:updated"],
            signatureHeader: "X-Hub-Signature (sha256 HMAC)",
          },
          error: null,
        },
        201,
      );
    },
  );

  app.post(
    "/api/organizations/:organizationId/source-control/azure-devops/webhook-secret",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const body = await readJsonObject(c);
      const connectionId = body?.["connectionId"];
      if (typeof connectionId !== "string" || connectionId.length > 128) {
        return c.json(
          {
            data: null,
            error: { code: "INVALID_CONNECTION", message: "A valid connectionId is required." },
          },
          400,
        );
      }
      validateSourceControlEncryptionKey();
      const secret = randomBytes(32).toString("base64url");
      const result = await prisma.sourceControlConnection.updateMany({
        where: {
          id: connectionId,
          organizationId,
          provider: "AZURE_DEVOPS",
          active: true,
        },
        data: {
          webhookSecretCiphertext: encryptSourceControlSecret(secret),
          webhookSecretHash: null,
        },
      });
      if (result.count !== 1) {
        return c.json(
          {
            data: null,
            error: {
              code: "CONNECTION_NOT_FOUND",
              message: "Active Azure DevOps connection not found.",
            },
          },
          404,
        );
      }
      const webhookUrl = new URL(
        `/api/webhooks/azure-devops/${encodeURIComponent(connectionId)}`,
        appOrigin(),
      ).toString();
      await recordAuditEvent({
        organizationId,
        actorId: c.get("userId"),
        eventType: "AZURE_DEVOPS_WEBHOOK_SECRET_ROTATED",
        metadata: { connectionId },
      });
      return c.json(
        {
          data: {
            webhookUrl,
            username: "ai-sdlc",
            password: secret,
            events: ["git.pullrequest.created", "git.pullrequest.updated"],
            authentication: "HTTP Basic authentication over HTTPS",
            resourceDetails: "All",
          },
          error: null,
        },
        201,
      );
    },
  );

  app.post(
    "/api/organizations/:organizationId/source-control/bitbucket/workspaces",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const connectionId = c.req.query("connectionId");
      if (!connectionId)
        return c.json(
          {
            data: null,
            error: { code: "INVALID_CONNECTION", message: "connectionId is required." },
          },
          400,
        );
      try {
        const connection = await connectionForOrganization(
          organizationId,
          connectionId,
          "BITBUCKET",
        );
        assertConnection(connection, organizationId, "BITBUCKET");
        const client = new BitbucketClient({
          accessToken: await getConnectionToken(connection, "BITBUCKET"),
        });
        return c.json({ data: await client.listWorkspaces(), error: null });
      } catch (error) {
        const result = providerErrorResponse(error, "BITBUCKET");
        return c.json({ data: null, error: result.error }, result.status);
      }
    },
  );

  app.get(
    "/api/organizations/:organizationId/source-control/bitbucket/repositories",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const connectionId = c.req.query("connectionId");
      const workspace = c.req.query("workspace");
      if (!connectionId || !workspace)
        return c.json(
          {
            data: null,
            error: { code: "INVALID_REQUEST", message: "connectionId and workspace are required." },
          },
          400,
        );
      try {
        const connection = await connectionForOrganization(
          organizationId,
          connectionId,
          "BITBUCKET",
        );
        assertConnection(connection, organizationId, "BITBUCKET");
        const client = new BitbucketClient({
          accessToken: await getConnectionToken(connection, "BITBUCKET"),
        });
        return c.json({ data: await client.listRepositories(workspace), error: null });
      } catch (error) {
        const result = providerErrorResponse(error, "BITBUCKET");
        return c.json({ data: null, error: result.error }, result.status);
      }
    },
  );

  app.post(
    "/api/organizations/:organizationId/source-control/bitbucket/repositories",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const selection = checkSelectionBody(await readJsonObject(c));
      if (!selection?.workspace)
        return c.json(
          {
            data: null,
            error: {
              code: "INVALID_SELECTION",
              message: "connectionId, workspace, and repositoryIds are required.",
            },
          },
          400,
        );
      try {
        const connection = await connectionForOrganization(
          organizationId,
          selection.connectionId,
          "BITBUCKET",
        );
        assertConnection(connection, organizationId, "BITBUCKET");
        const client = new BitbucketClient({
          accessToken: await getConnectionToken(connection, "BITBUCKET"),
        });
        const available = await client.listRepositories(selection.workspace);
        const selected = available.items.filter((repo) =>
          selection.repositoryIds.includes(repo.externalId),
        );
        if (selected.length !== new Set(selection.repositoryIds).size) {
          return c.json(
            {
              data: null,
              error: {
                code: "INVALID_SELECTION",
                message: "A repository is not accessible from this workspace.",
              },
            },
            400,
          );
        }
        const repositories = await saveRepositories(
          organizationId,
          connection.id,
          "BITBUCKET",
          selected,
        );
        await recordAuditEvent({
          organizationId,
          actorId: c.get("userId"),
          eventType: "BITBUCKET_REPOSITORIES_SELECTED",
          metadata: { repositoryCount: repositories.length },
        });
        return c.json({ data: repositories, error: null }, 201);
      } catch (error) {
        if (error instanceof Error && error.message === "REPOSITORY_LIMIT_REACHED") {
          return c.json(
            {
              data: null,
              error: {
                code: "REPOSITORY_LIMIT_REACHED",
                message: "The selected repositories exceed this organization's plan limit.",
              },
            },
            409,
          );
        }
        const result = providerErrorResponse(error, "BITBUCKET");
        return c.json({ data: null, error: result.error }, result.status);
      }
    },
  );

  app.get(
    "/api/organizations/:organizationId/source-control/azure-devops/projects",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const connectionId = c.req.query("connectionId");
      if (!connectionId)
        return c.json(
          {
            data: null,
            error: { code: "INVALID_CONNECTION", message: "connectionId is required." },
          },
          400,
        );
      try {
        const connection = await connectionForOrganization(
          organizationId,
          connectionId,
          "AZURE_DEVOPS",
        );
        assertConnection(connection, organizationId, "AZURE_DEVOPS");
        const client = new AzureDevOpsClient({
          accessToken: await getConnectionToken(connection, "AZURE_DEVOPS"),
          organization: connection.accountName,
        });
        return c.json({ data: await client.listProjects(), error: null });
      } catch (error) {
        const result = providerErrorResponse(error, "AZURE_DEVOPS");
        return c.json({ data: null, error: result.error }, result.status);
      }
    },
  );

  app.get(
    "/api/organizations/:organizationId/source-control/azure-devops/repositories",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const connectionId = c.req.query("connectionId");
      const project = c.req.query("project");
      if (!connectionId || !project)
        return c.json(
          {
            data: null,
            error: { code: "INVALID_REQUEST", message: "connectionId and project are required." },
          },
          400,
        );
      try {
        const connection = await connectionForOrganization(
          organizationId,
          connectionId,
          "AZURE_DEVOPS",
        );
        assertConnection(connection, organizationId, "AZURE_DEVOPS");
        const client = new AzureDevOpsClient({
          accessToken: await getConnectionToken(connection, "AZURE_DEVOPS"),
          organization: connection.accountName,
        });
        return c.json({ data: await client.listRepositories(project), error: null });
      } catch (error) {
        const result = providerErrorResponse(error, "AZURE_DEVOPS");
        return c.json({ data: null, error: result.error }, result.status);
      }
    },
  );

  app.post(
    "/api/organizations/:organizationId/source-control/azure-devops/repositories",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const selection = checkSelectionBody(await readJsonObject(c));
      if (!selection?.project)
        return c.json(
          {
            data: null,
            error: {
              code: "INVALID_SELECTION",
              message: "connectionId, project, and repositoryIds are required.",
            },
          },
          400,
        );
      try {
        const connection = await connectionForOrganization(
          organizationId,
          selection.connectionId,
          "AZURE_DEVOPS",
        );
        assertConnection(connection, organizationId, "AZURE_DEVOPS");
        const client = new AzureDevOpsClient({
          accessToken: await getConnectionToken(connection, "AZURE_DEVOPS"),
          organization: connection.accountName,
        });
        const projects = await client.listProjects();
        const authorizedProject = projects.items.find(
          (project) =>
            project.id === selection.project ||
            project.name.toLowerCase() === selection.project?.toLowerCase(),
        );
        if (!authorizedProject) {
          return c.json(
            {
              data: null,
              error: {
                code: "INVALID_SELECTION",
                message: "The selected project is not accessible to this connection.",
              },
            },
            400,
          );
        }
        const available = await client.listRepositories(authorizedProject.name);
        const selected = available.items.filter((repo) =>
          selection.repositoryIds.includes(repo.externalId),
        );
        if (selected.length !== new Set(selection.repositoryIds).size) {
          return c.json(
            {
              data: null,
              error: {
                code: "INVALID_SELECTION",
                message: "A repository is not accessible from this project.",
              },
            },
            400,
          );
        }
        const repositories = await saveRepositories(
          organizationId,
          connection.id,
          "AZURE_DEVOPS",
          selected,
        );
        await recordAuditEvent({
          organizationId,
          actorId: c.get("userId"),
          eventType: "AZURE_DEVOPS_REPOSITORIES_SELECTED",
          metadata: { repositoryCount: repositories.length, project: authorizedProject.name },
        });
        return c.json({ data: repositories, error: null }, 201);
      } catch (error) {
        if (error instanceof Error && error.message === "REPOSITORY_LIMIT_REACHED") {
          return c.json(
            {
              data: null,
              error: {
                code: "REPOSITORY_LIMIT_REACHED",
                message: "The selected repositories exceed this organization's plan limit.",
              },
            },
            409,
          );
        }
        const result = providerErrorResponse(error, "AZURE_DEVOPS");
        return c.json({ data: null, error: result.error }, result.status);
      }
    },
  );

  app.delete(
    "/api/organizations/:organizationId/source-control/connections/:connectionId/external",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const connection = await prisma.sourceControlConnection.findFirst({
        where: {
          id: c.req.param("connectionId"),
          organizationId,
          provider: { in: ["BITBUCKET", "AZURE_DEVOPS"] },
          active: true,
        },
      });
      if (!connection) {
        return c.json(
          {
            data: null,
            error: {
              code: "CONNECTION_NOT_FOUND",
              message: "Active provider connection not found.",
            },
          },
          404,
        );
      }
      let remoteRevocation: "CONFIRMED" | "FAILED" | "NOT_SUPPORTED" = "NOT_SUPPORTED";
      if (connection.provider === "BITBUCKET") {
        try {
          const config = oauthConfig("BITBUCKET");
          const credentials = decryptSourceControlCredentials(connection.credentialCiphertext);
          await revokeBitbucketOAuthToken({
            clientId: config.clientId,
            clientSecret: config.clientSecret,
            token: credentials.accessToken,
          });
          remoteRevocation = "CONFIRMED";
        } catch (error) {
          remoteRevocation = "FAILED";
          console.error("[source-control.bitbucket.disconnect] revocation failed", {
            errorType: error instanceof Error ? error.name : "unknown",
          });
        }
      }
      await prisma.$transaction(async (tx) => {
        await tx.sourceControlConnection.updateMany({
          where: { id: connection.id, organizationId, active: true },
          data: {
            active: false,
            revokedAt: new Date(),
            credentialCiphertext: "REVOKED",
            webhookSecretHash: null,
            webhookSecretCiphertext: null,
          },
        });
        await tx.repository.updateMany({
          where: { sourceControlConnectionId: connection.id, organizationId },
          data: { enabled: false },
        });
      });
      const eventType =
        connection.provider === "BITBUCKET"
          ? "BITBUCKET_SOURCE_CONTROL_DISCONNECTED"
          : "AZURE_DEVOPS_SOURCE_CONTROL_DISCONNECTED";
      await recordAuditEvent({
        organizationId,
        actorId: c.get("userId"),
        eventType,
        metadata: { provider: connection.provider, remoteRevocation },
      });
      if (remoteRevocation === "FAILED") {
        return c.json(
          {
            data: { disconnected: true, remoteRevocation },
            error: {
              code: "REMOTE_REVOCATION_FAILED",
              message:
                "Access was disabled in Nomalog but the provider could not confirm token revocation. Revoke the grant in the provider account settings.",
            },
          },
          502,
        );
      }
      return c.json({
        data: { disconnected: true, remoteRevocation },
        error:
          remoteRevocation === "NOT_SUPPORTED"
            ? {
                code: "REMOTE_REVOCATION_NOT_SUPPORTED",
                message:
                  "Access was disabled in Nomalog. Revoke the Microsoft Entra application grant from your account's consent settings.",
              }
            : null,
      });
    },
  );
}
