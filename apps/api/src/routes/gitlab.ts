import { createHash, randomBytes } from "node:crypto";
import type { Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { ensureOrganizationAccess, prisma, recordAuditEvent, type Prisma } from "@ai-sdlc/db";
import { resolveOrganizationEntitlements } from "@ai-sdlc/billing";
import {
  decryptGitLabCredentials,
  encryptGitLabCredentials,
  exchangeGitLabOAuthCode,
  refreshGitLabOAuthToken,
  revokeGitLabOAuthToken,
  SourceControlProviderError,
  validateGitLabEncryptionKey,
} from "@ai-sdlc/source-control";
import { GitLabClient } from "@ai-sdlc/source-control/gitlab";
import { SESSION_COOKIE, verifySessionCookieValue } from "../auth/session.js";
import { requireAuth, requireOrganizationRole } from "../middleware/auth.js";
import { readJsonObject } from "../request-body.js";
import type { AppEnv } from "../types.js";

const STATE_COOKIE = "nomalog_gitlab_oauth_state";
const VERIFIER_COOKIE = "nomalog_gitlab_oauth_verifier";
const ORGANIZATION_COOKIE = "nomalog_gitlab_oauth_org";
const REQUIRED_SCOPES = ["read_user", "read_api", "read_repository"] as const;

function assertRequiredScopes(scopes: string[]): void {
  if (REQUIRED_SCOPES.some((scope) => !scopes.includes(scope))) {
    throw new SourceControlProviderError(
      "GitLab authorization did not grant all required read-only scopes.",
      "PERMISSION",
    );
  }
}

function appOrigin(): string {
  const configured = process.env["APP_URL"];
  if (!configured) throw new Error("APP_URL must be configured for GitLab OAuth.");
  const url = new URL(configured);
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new Error("APP_URL must use HTTPS for GitLab OAuth.");
  }
  return url.origin;
}

function oauthConfig(): { clientId: string; clientSecret: string; redirectUri: string } {
  const clientId = process.env["GITLAB_OAUTH_CLIENT_ID"];
  const clientSecret = process.env["GITLAB_OAUTH_CLIENT_SECRET"];
  if (!clientId || !clientSecret) {
    throw new Error("GITLAB_OAUTH_CLIENT_ID and GITLAB_OAUTH_CLIENT_SECRET are required.");
  }
  const redirectUri =
    process.env["GITLAB_OAUTH_CALLBACK_URL"] ??
    new URL("/api/auth/gitlab/callback", appOrigin()).toString();
  const callbackUrl = new URL(redirectUri);
  if (callbackUrl.origin !== appOrigin() || callbackUrl.pathname !== "/api/auth/gitlab/callback") {
    throw new Error("GITLAB_OAUTH_CALLBACK_URL must be the same-origin GitLab callback route.");
  }
  return { clientId, clientSecret, redirectUri };
}

function oauthCookieOptions(origin: string) {
  return {
    httpOnly: true,
    secure: origin.startsWith("https://"),
    sameSite: "Lax" as const,
    path: "/api",
    maxAge: 600,
  };
}

function clearOAuthCookies(c: Context<AppEnv>, origin: string) {
  const options = oauthCookieOptions(origin);
  deleteCookie(c, STATE_COOKIE, options);
  deleteCookie(c, VERIFIER_COOKIE, options);
  deleteCookie(c, ORGANIZATION_COOKIE, options);
}

function redirectWithError(origin: string, code: string): string {
  const url = new URL("/dashboard/repositories", origin);
  url.searchParams.set("gitlabError", code);
  return url.toString();
}

async function getConnectionAccessToken(connection: {
  id: string;
  organizationId: string;
  credentialCiphertext: string;
  active: boolean;
}): Promise<string> {
  if (!connection.active) {
    throw new SourceControlProviderError("GitLab connection is disconnected.", "AUTHENTICATION");
  }
  const credentials = decryptGitLabCredentials(connection.credentialCiphertext);
  if (Date.parse(credentials.expiresAt) > Date.now() + 5 * 60 * 1000) {
    return credentials.accessToken;
  }

  const clientId = process.env["GITLAB_OAUTH_CLIENT_ID"];
  const clientSecret = process.env["GITLAB_OAUTH_CLIENT_SECRET"];
  if (!clientId || !clientSecret) {
    throw new SourceControlProviderError(
      "GitLab OAuth is not configured for token refresh.",
      "UNAVAILABLE",
    );
  }
  try {
    const refreshed = await refreshGitLabOAuthToken({
      clientId,
      clientSecret,
      refreshToken: credentials.refreshToken,
    });
    const nextEnvelope = encryptGitLabCredentials({
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      expiresAt: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString(),
    });
    const result = await prisma.sourceControlConnection.updateMany({
      where: {
        id: connection.id,
        organizationId: connection.organizationId,
        active: true,
        credentialCiphertext: connection.credentialCiphertext,
      },
      data: { credentialCiphertext: nextEnvelope, scopes: refreshed.scope },
    });
    assertRequiredScopes(refreshed.scope);
    if (result.count === 0) {
      const latest = await prisma.sourceControlConnection.findFirst({
        where: {
          id: connection.id,
          organizationId: connection.organizationId,
          provider: "GITLAB",
          active: true,
        },
        select: { credentialCiphertext: true },
      });
      if (!latest) {
        throw new SourceControlProviderError(
          "GitLab connection was disconnected during token refresh.",
          "AUTHENTICATION",
        );
      }
      const latestCredentials = decryptGitLabCredentials(latest.credentialCiphertext);
      if (Date.parse(latestCredentials.expiresAt) <= Date.now()) {
        throw new SourceControlProviderError(
          "GitLab token refresh did not produce an active credential.",
          "AUTHENTICATION",
        );
      }
      return latestCredentials.accessToken;
    }
    return refreshed.accessToken;
  } catch (error) {
    if (error instanceof SourceControlProviderError) throw error;
    throw new SourceControlProviderError("GitLab credential refresh failed.", "UNAVAILABLE");
  }
}

export function registerGitLabRoutes(app: Hono<AppEnv>): void {
  app.get("/api/source-control/gitlab/connect", async (c) => {
    const origin = appOrigin();
    const session = await verifySessionCookieValue(getCookie(c, SESSION_COOKIE));
    if (!session) {
      const organizationId = c.req.query("organizationId");
      const returnTo = organizationId
        ? `/api/source-control/gitlab/connect?organizationId=${encodeURIComponent(organizationId)}`
        : "/dashboard/repositories";
      return c.redirect(`/api/auth/github/login?redirectTo=${encodeURIComponent(returnTo)}`);
    }
    const organizationId = c.req.query("organizationId");
    if (!organizationId) return c.redirect(redirectWithError(origin, "missing_organization"));
    try {
      await ensureOrganizationAccess({
        prisma,
        userId: session.userId,
        organizationId,
        minimumRole: "ADMIN",
      });
    } catch {
      return c.redirect(redirectWithError(origin, "forbidden"));
    }

    let config: ReturnType<typeof oauthConfig>;
    try {
      config = oauthConfig();
      validateGitLabEncryptionKey();
    } catch {
      return c.redirect(redirectWithError(origin, "not_configured"));
    }
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const cookieOptions = oauthCookieOptions(origin);
    setCookie(c, STATE_COOKIE, state, cookieOptions);
    setCookie(c, VERIFIER_COOKIE, verifier, cookieOptions);
    setCookie(c, ORGANIZATION_COOKIE, organizationId, cookieOptions);

    const authorizeUrl = new URL("https://gitlab.com/oauth/authorize");
    authorizeUrl.searchParams.set("client_id", config.clientId);
    authorizeUrl.searchParams.set("redirect_uri", config.redirectUri);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("scope", REQUIRED_SCOPES.join(" "));
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("code_challenge", challenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    return c.redirect(authorizeUrl.toString());
  });

  app.get("/api/auth/gitlab/callback", async (c) => {
    let origin: string;
    try {
      origin = appOrigin();
    } catch {
      return c.text("GitLab OAuth callback URL is not configured.", 503);
    }
    const search = new URL(c.req.url).search;
    const session = await verifySessionCookieValue(getCookie(c, SESSION_COOKIE));
    if (!session) {
      const returnTo = `/api/auth/gitlab/callback${search}`;
      return c.redirect(`/api/auth/github/login?redirectTo=${encodeURIComponent(returnTo)}`);
    }

    const code = c.req.query("code");
    const state = c.req.query("state");
    const expectedState = getCookie(c, STATE_COOKIE);
    const verifier = getCookie(c, VERIFIER_COOKIE);
    const organizationId = getCookie(c, ORGANIZATION_COOKIE);
    clearOAuthCookies(c, origin);
    if (!code || !state || !expectedState || state !== expectedState || !verifier) {
      return c.redirect(redirectWithError(origin, "invalid_oauth_state"));
    }
    if (c.req.query("error")) {
      return c.redirect(redirectWithError(origin, "authorization_denied"));
    }
    if (!organizationId) {
      return c.redirect(redirectWithError(origin, "missing_organization"));
    }
    try {
      await ensureOrganizationAccess({
        prisma,
        userId: session.userId,
        organizationId,
        minimumRole: "ADMIN",
      });
    } catch {
      return c.redirect(redirectWithError(origin, "forbidden"));
    }

    try {
      const config = oauthConfig();
      const token = await exchangeGitLabOAuthCode({
        ...config,
        code,
        codeVerifier: verifier,
      });
      assertRequiredScopes(token.scope);
      const gitLab = new GitLabClient({ accessToken: token.accessToken });
      const profile = await gitLab.getCurrentUser();
      const credentialCiphertext = encryptGitLabCredentials({
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        expiresAt: new Date(Date.now() + token.expiresIn * 1000).toISOString(),
      });
      await prisma.sourceControlConnection.upsert({
        where: {
          organizationId_provider_externalAccountId: {
            organizationId,
            provider: "GITLAB",
            externalAccountId: profile.id,
          },
        },
        create: {
          organizationId,
          provider: "GITLAB",
          externalAccountId: profile.id,
          accountName: profile.username,
          credentialCiphertext,
          scopes: token.scope,
          capabilities: gitLab.getCapabilities() as unknown as Prisma.InputJsonValue,
          active: true,
        },
        update: {
          accountName: profile.username,
          credentialCiphertext,
          scopes: token.scope,
          capabilities: gitLab.getCapabilities() as unknown as Prisma.InputJsonValue,
          webhookSecretHash: null,
          active: true,
          revokedAt: null,
        },
      });
      await recordAuditEvent({
        organizationId,
        actorId: session.userId,
        eventType: "GITLAB_SOURCE_CONTROL_CONNECTED",
        metadata: { provider: "GITLAB", accountName: profile.username, scopes: token.scope },
      });
      return c.redirect(`${origin}/dashboard/repositories?gitlabConnected=1`);
    } catch (error) {
      const category =
        error instanceof SourceControlProviderError
          ? error.kind.toLowerCase()
          : "connection_failed";
      console.error("[gitlab.oauth] connection failed", {
        category,
        errorType: error instanceof Error ? error.name : "unknown",
      });
      return c.redirect(redirectWithError(origin, `connection_${category}`));
    }
  });

  app.get(
    "/api/organizations/:organizationId/source-control/connections",
    requireAuth,
    requireOrganizationRole("VIEWER"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const connections = await prisma.sourceControlConnection.findMany({
        where: { organizationId, active: true },
        select: {
          id: true,
          provider: true,
          accountName: true,
          scopes: true,
          capabilities: true,
          lastCheckedAt: true,
          createdAt: true,
          _count: { select: { repositories: true } },
        },
        orderBy: { createdAt: "desc" },
      });
      return c.json({ data: connections, error: null });
    },
  );

  app.post(
    "/api/organizations/:organizationId/source-control/gitlab/webhook-secret",
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

      const webhookUrl = new URL("/api/webhooks/gitlab", appOrigin()).toString();
      const secret = randomBytes(32).toString("base64url");
      const result = await prisma.sourceControlConnection.updateMany({
        where: {
          id: connectionId,
          organizationId,
          provider: "GITLAB",
          active: true,
        },
        data: { webhookSecretHash: createHash("sha256").update(secret).digest("hex") },
      });
      if (result.count !== 1) {
        return c.json(
          {
            data: null,
            error: { code: "CONNECTION_NOT_FOUND", message: "Active GitLab connection not found." },
          },
          404,
        );
      }

      await recordAuditEvent({
        organizationId,
        actorId: c.get("userId"),
        eventType: "GITLAB_WEBHOOK_SECRET_ROTATED",
        metadata: { connectionId },
      });
      return c.json({ data: { webhookUrl, secret }, error: null }, 201);
    },
  );

  app.get(
    "/api/organizations/:organizationId/source-control/gitlab/projects",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const connectionId = c.req.query("connectionId");
      if (!connectionId) {
        return c.json(
          {
            data: null,
            error: { code: "INVALID_CONNECTION", message: "connectionId is required." },
          },
          400,
        );
      }
      const connection = await prisma.sourceControlConnection.findFirst({
        where: {
          id: connectionId,
          organizationId,
          provider: "GITLAB",
          active: true,
        },
      });
      if (!connection) {
        return c.json(
          {
            data: null,
            error: { code: "CONNECTION_NOT_FOUND", message: "Active GitLab connection not found." },
          },
          404,
        );
      }
      try {
        const accessToken = await getConnectionAccessToken(connection);
        const gitLab = new GitLabClient({ accessToken });
        const result = await gitLab.listRepositories();
        const capabilities = gitLab.getCapabilities();
        capabilities.capabilities["repository_discovery"] = result.capability;
        await prisma.sourceControlConnection.updateMany({
          where: { id: connection.id, organizationId, active: true },
          data: {
            lastCheckedAt: new Date(),
            capabilities: capabilities as unknown as Prisma.InputJsonValue,
          },
        });
        return c.json({ data: result, error: null });
      } catch (error) {
        const response = providerErrorResponse(error);
        return c.json({ data: null, error: response.error }, response.status);
      }
    },
  );

  app.post(
    "/api/organizations/:organizationId/source-control/gitlab/repositories",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const body = await readJsonObject(c);
      const connectionId = body?.["connectionId"];
      const rawProjectIds = body?.["projectIds"];
      if (
        typeof connectionId !== "string" ||
        !Array.isArray(rawProjectIds) ||
        rawProjectIds.length === 0 ||
        rawProjectIds.length > 100 ||
        rawProjectIds.some((id) => typeof id !== "string" || id.length > 128) ||
        new Set(rawProjectIds).size !== rawProjectIds.length
      ) {
        return c.json(
          {
            data: null,
            error: {
              code: "INVALID_SELECTION",
              message: "Select between 1 and 100 unique GitLab projects.",
            },
          },
          400,
        );
      }
      const connection = await prisma.sourceControlConnection.findFirst({
        where: {
          id: connectionId,
          organizationId,
          provider: "GITLAB",
          active: true,
        },
      });
      if (!connection) {
        return c.json(
          {
            data: null,
            error: { code: "CONNECTION_NOT_FOUND", message: "Active GitLab connection not found." },
          },
          404,
        );
      }
      try {
        const accessToken = await getConnectionAccessToken(connection);
        const available = await new GitLabClient({ accessToken }).listRepositories();
        const projectIds = rawProjectIds.filter((id): id is string => typeof id === "string");
        const selected = available.items.filter((repository) =>
          projectIds.includes(repository.externalId),
        );
        if (selected.length !== rawProjectIds.length) {
          return c.json(
            {
              data: null,
              error: {
                code: "INVALID_SELECTION",
                message: "A selected GitLab project is not accessible to this connection.",
              },
            },
            400,
          );
        }
        const repositories = await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId})) IS NULL AS locked`;
          const entitlements = await resolveOrganizationEntitlements(organizationId, tx);
          const existing = await tx.repository.findMany({
            where: { organizationId, enabled: true },
            select: { provider: true, externalId: true },
          });
          const knownExternalIds = new Set(
            existing.filter((repo) => repo.provider === "GITLAB").map((repo) => repo.externalId),
          );
          const additions = selected.filter(
            (repository) => !knownExternalIds.has(repository.externalId),
          ).length;
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
                    provider: "GITLAB",
                    owner: repository.owner,
                    name: repository.name,
                  },
                },
                create: {
                  organizationId,
                  provider: "GITLAB",
                  sourceControlConnectionId: connection.id,
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
                  sourceControlConnectionId: connection.id,
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
        await recordAuditEvent({
          organizationId,
          actorId: c.get("userId"),
          eventType: "GITLAB_REPOSITORIES_SELECTED",
          metadata: { provider: "GITLAB", repositoryCount: repositories.length },
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
        const response = providerErrorResponse(error);
        return c.json({ data: null, error: response.error }, response.status);
      }
    },
  );

  app.delete(
    "/api/organizations/:organizationId/source-control/connections/:connectionId",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const connection = await prisma.sourceControlConnection.findFirst({
        where: {
          id: c.req.param("connectionId"),
          organizationId,
          provider: "GITLAB",
          active: true,
        },
      });
      if (!connection) {
        return c.json(
          {
            data: null,
            error: { code: "CONNECTION_NOT_FOUND", message: "Active GitLab connection not found." },
          },
          404,
        );
      }
      let remoteRevocationError = false;
      try {
        const config = oauthConfig();
        const credentials = decryptGitLabCredentials(connection.credentialCiphertext);
        await revokeGitLabOAuthToken({
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          token: credentials.accessToken,
        });
      } catch (error) {
        remoteRevocationError = true;
        const category = error instanceof SourceControlProviderError ? error.kind : "UNEXPECTED";
        console.error("[gitlab.disconnect] remote token revocation failed", { category });
      }
      await prisma.$transaction(async (tx) => {
        await tx.sourceControlConnection.updateMany({
          where: { id: connection.id, organizationId, active: true },
          data: {
            active: false,
            revokedAt: new Date(),
            credentialCiphertext: "REVOKED",
            webhookSecretHash: null,
          },
        });
        await tx.repository.updateMany({
          where: { sourceControlConnectionId: connection.id, organizationId },
          data: { enabled: false },
        });
      });
      await recordAuditEvent({
        organizationId,
        actorId: c.get("userId"),
        eventType: "GITLAB_SOURCE_CONTROL_DISCONNECTED",
        metadata: { provider: "GITLAB", accountName: connection.accountName },
      });
      if (remoteRevocationError) {
        return c.json(
          {
            data: { disconnected: true, remoteRevocation: "FAILED" },
            error: {
              code: "REMOTE_REVOCATION_FAILED",
              message:
                "The connection was disabled locally, but GitLab could not confirm token revocation. Revoke the OAuth grant in GitLab account settings.",
            },
          },
          502,
        );
      }
      return c.json({ data: { disconnected: true, remoteRevocation: "CONFIRMED" }, error: null });
    },
  );
}

function providerErrorResponse(error: unknown): {
  status: 400 | 401 | 403 | 429 | 502;
  error: { code: string; message: string };
} {
  if (!(error instanceof SourceControlProviderError)) {
    console.error("[gitlab.provider] operation failed", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return {
      status: 502,
      error: {
        code: "GITLAB_UNAVAILABLE",
        message: "GitLab could not complete the request. Retry later.",
      },
    };
  }
  const status =
    error.kind === "AUTHENTICATION"
      ? 401
      : error.kind === "PERMISSION"
        ? 403
        : error.kind === "RATE_LIMITED"
          ? 429
          : error.kind === "INVALID_RESPONSE"
            ? 400
            : 502;
  return {
    status,
    error: {
      code: `GITLAB_${error.kind}`,
      message: error.message,
    },
  };
}
