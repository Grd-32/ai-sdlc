import { createHash, timingSafeEqual, X509Certificate } from "node:crypto";
import { type Context } from "hono";
import {
  SAML,
  ValidateInResponseTo,
  type CacheProvider,
  type Profile,
} from "@node-saml/node-saml";
import {
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  ClientSecretBasic,
  customFetch,
  discovery,
  fetchUserInfo,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
  type CustomFetch,
} from "openid-client";
import { prisma, recordAuditEvent } from "@ai-sdlc/db";
import { createSessionCookieValue, SESSION_COOKIE, SESSION_TTL_SECONDS } from "./session.js";
import { decryptSsoSecret } from "./sso-secrets.js";
import type { AppEnv } from "../types.js";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";

const SSO_STATE_COOKIE_PREFIX = "nomalog_sso_";
const TRANSACTION_TTL_MS = 10 * 60 * 1000;
const appUrl = () => process.env["APP_URL"] ?? "http://localhost:3000";
const isSecureDeployment = () => appUrl().startsWith("https://");

type ProviderRecord = NonNullable<Awaited<ReturnType<typeof getProvider>>>;

function getStateCookieName(providerId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(providerId)) {
    throw new Error("Invalid SSO provider identifier");
  }
  return `${SSO_STATE_COOKIE_PREFIX}${providerId}`;
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeRedirectPath(value: unknown): string {
  if (
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("://")
  ) {
    return value;
  }
  return "/dashboard";
}

function stringProperty(record: unknown, property: string): string | undefined {
  if (typeof record !== "object" || record === null || Array.isArray(record)) return undefined;
  const value = (record as Record<string, unknown>)[property];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeIssuer(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost") ||
    url.hostname.endsWith(".local")
  ) {
    throw new Error("OIDC issuer must be a public HTTPS issuer URL.");
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

function assertOidcIssuerAllowed(issuer: string): URL {
  const normalized = normalizeIssuer(issuer);
  const configured = (process.env["SSO_OIDC_ALLOWED_ISSUERS"] ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(normalizeIssuer);
  if (!configured.includes(normalized)) {
    throw new Error("This OIDC issuer has not been approved by the service operator.");
  }
  return new URL(issuer);
}

function createOidcFetch(issuer: URL): CustomFetch {
  return async (resource, options) => {
    const target = new URL(resource);
    if (target.protocol !== "https:" || target.origin !== issuer.origin) {
      throw new Error("OIDC endpoint is outside the approved issuer origin.");
    }
    return fetch(target, { ...options, redirect: "error" });
  };
}

async function getProvider(providerId: string, enabledOnly = true) {
  return prisma.identityProvider.findFirst({
    where: { id: providerId, ...(enabledOnly ? { enabled: true } : {}) },
    include: {
      organization: {
        select: { id: true, slug: true, ssoEnforced: true },
      },
    },
  });
}

async function loadOidcConfiguration(provider: ProviderRecord) {
  if (!provider.issuer || !provider.clientId || !provider.clientSecretEncrypted) {
    throw new Error("OIDC provider configuration is incomplete.");
  }
  const issuer = assertOidcIssuerAllowed(provider.issuer);
  const clientSecret = decryptSsoSecret(provider.clientSecretEncrypted);
  const fetcher = createOidcFetch(issuer);
  return discovery(issuer, provider.clientId, undefined, ClientSecretBasic(clientSecret), {
    [customFetch]: fetcher,
  });
}

function getSamlConfiguration(provider: ProviderRecord): SAML {
  const metadata = provider.metadata;
  const entryPoint = stringProperty(metadata, "entryPoint");
  const idpIssuer = stringProperty(metadata, "idpIssuer") ?? provider.issuer ?? undefined;
  const idpCertificate = stringProperty(metadata, "idpCertificate");
  if (!entryPoint || !idpIssuer || !idpCertificate || !isSecureDeployment()) {
    throw new Error("SAML provider configuration is incomplete or the app URL is not HTTPS.");
  }
  const entry = new URL(entryPoint);
  if (entry.protocol !== "https:" || entry.username || entry.password) {
    throw new Error("SAML entry point must be an HTTPS URL.");
  }
  new X509Certificate(idpCertificate);
  const entityId = `${appUrl()}/api/auth/sso/saml/metadata/${provider.id}`;
  return new SAML({
    entryPoint: entryPoint,
    issuer: entityId,
    idpIssuer,
    callbackUrl: `${appUrl()}/api/auth/sso/saml/callback`,
    idpCert: idpCertificate,
    audience: entityId,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    validateInResponseTo: ValidateInResponseTo.always,
    requestIdExpirationPeriodMs: TRANSACTION_TTL_MS,
    acceptedClockSkewMs: 3_000,
    disableRequestedAuthnContext: true,
    cacheProvider: samlRequestCache,
  });
}

const samlRequestCache: CacheProvider = {
  async saveAsync(key, value) {
    const createdAt = new Date();
    await prisma.samlRequestCache.deleteMany({ where: { expiresAt: { lte: createdAt } } });
    await prisma.samlRequestCache.upsert({
      where: { requestId: key },
      create: {
        requestId: key,
        value,
        createdAt,
        expiresAt: new Date(createdAt.getTime() + TRANSACTION_TTL_MS),
      },
      update: {
        value,
        createdAt,
        expiresAt: new Date(createdAt.getTime() + TRANSACTION_TTL_MS),
      },
    });
    return { value, createdAt: createdAt.getTime() };
  },
  async getAsync(key) {
    const item = await prisma.samlRequestCache.findUnique({
      where: { requestId: key },
    });
    if (!item) return null;
    if (item.expiresAt.getTime() <= Date.now()) {
      await prisma.samlRequestCache.deleteMany({ where: { requestId: key, expiresAt: { lte: new Date() } } });
      return null;
    }
    return item.value;
  },
  async removeAsync(key) {
    if (!key) return null;
    const removed = await prisma.samlRequestCache.deleteMany({ where: { requestId: key } });
    return removed.count === 1 ? key : null;
  },
};

function safeCookieOptions(sameSite: "Lax" | "None") {
  return {
    httpOnly: true,
    secure: isSecureDeployment(),
    sameSite,
    maxAge: Math.floor(TRANSACTION_TTL_MS / 1000),
    path: "/api/auth/sso",
  } as const;
}

async function createTransaction(
  provider: ProviderRecord,
  state: string,
  redirectTo: string,
  values: { codeVerifier?: string; nonce?: string } = {},
) {
  const now = new Date();
  await Promise.all([
    prisma.ssoTransaction.deleteMany({ where: { expiresAt: { lte: now } } }),
    prisma.samlRequestCache.deleteMany({ where: { expiresAt: { lte: now } } }),
  ]);
  await prisma.ssoTransaction.create({
    data: {
      stateHash: hash(state),
      identityProviderId: provider.id,
      organizationId: provider.organizationId,
      codeVerifier: values.codeVerifier,
      nonce: values.nonce,
      redirectTo,
      expiresAt: new Date(Date.now() + TRANSACTION_TTL_MS),
    },
  });
}

async function consumeTransaction(
  c: Context<AppEnv>,
  state: string,
  providerType: "OIDC" | "SAML",
) {
  const transaction = await prisma.ssoTransaction.findUnique({
    where: { stateHash: hash(state) },
  });
  if (!transaction || transaction.expiresAt.getTime() <= Date.now()) return null;

  const cookieName = getStateCookieName(transaction.identityProviderId);
  const cookieState = getCookie(c, cookieName);
  deleteCookie(c, cookieName, { path: "/api/auth/sso" });
  if (
    !cookieState ||
    Buffer.byteLength(cookieState) !== Buffer.byteLength(state) ||
    !timingSafeEqual(Buffer.from(cookieState), Buffer.from(state))
  ) {
    return null;
  }

  const provider = await getProvider(transaction.identityProviderId);
  if (!provider || provider.type !== providerType || provider.organizationId !== transaction.organizationId) {
    return null;
  }
  const consumed = await prisma.ssoTransaction.deleteMany({
    where: { id: transaction.id, expiresAt: { gt: new Date() } },
  });
  if (consumed.count !== 1) return null;
  return { transaction, provider };
}

function extractSamlValue(profile: Profile, configuredName: string | undefined): string | undefined {
  const profileValues: Record<string, unknown> = { ...profile };
  const candidates = [
    configuredName,
    "email",
    "mail",
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
    "urn:oid:0.9.2342.19200300.100.1.3",
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    const value = profileValues[candidate];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value) && typeof value[0] === "string" && value[0].trim()) {
      return value[0].trim();
    }
  }
  return undefined;
}

function emailDomain(email: string): string {
  const separator = email.lastIndexOf("@");
  return separator > 0 ? email.slice(separator + 1).toLowerCase() : "";
}

async function establishFederatedSession(
  c: Context<AppEnv>,
  provider: ProviderRecord,
  profile: { subject: string; email: string; name?: string },
  authMethod: "OIDC" | "SAML",
  redirectTo: string,
): Promise<Response> {
  const email = profile.email.trim().toLowerCase();
  const domain = emailDomain(email);
  if (!profile.subject || !domain) return ssoErrorRedirect("failed");

  const verifiedDomain = await prisma.organizationDomain.findFirst({
    where: { organizationId: provider.organizationId, domain, verified: true },
    select: { id: true },
  });
  if (!verifiedDomain) return ssoErrorRedirect("domain-not-verified");

  const existingIdentity = await prisma.federatedIdentity.findUnique({
    where: {
      identityProviderId_subject: {
        identityProviderId: provider.id,
        subject: profile.subject,
      },
    },
    select: { userId: true, email: true },
  });

  let userId = existingIdentity?.userId;
  if (!userId) {
    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" }, active: true },
      select: {
        id: true,
        memberships: {
          where: { organizationId: provider.organizationId, scimActive: true },
          select: { id: true },
        },
      },
    });
    if (!user || user.memberships.length === 0) return ssoErrorRedirect("not-provisioned");
    userId = user.id;
    try {
      await prisma.federatedIdentity.create({
        data: {
          organizationId: provider.organizationId,
          identityProviderId: provider.id,
          userId,
          subject: profile.subject,
          email,
        },
      });
    } catch (error) {
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        error.code !== "P2002"
      ) {
        throw error;
      }
      const racedIdentity = await prisma.federatedIdentity.findUnique({
        where: {
          identityProviderId_subject: {
            identityProviderId: provider.id,
            subject: profile.subject,
          },
        },
        select: { userId: true },
      });
      if (!racedIdentity || racedIdentity.userId !== userId) return ssoErrorRedirect("failed");
    }
  } else {
    const activeMembership = await prisma.user.findFirst({
      where: {
        id: userId,
        active: true,
        memberships: {
          some: { organizationId: provider.organizationId, scimActive: true },
        },
      },
      select: { id: true },
    });
    if (!activeMembership) return ssoErrorRedirect("not-provisioned");
    if (existingIdentity?.email.toLowerCase() !== email) {
      await prisma.federatedIdentity.update({
        where: {
          identityProviderId_subject: {
            identityProviderId: provider.id,
            subject: profile.subject,
          },
        },
        data: { email },
      });
    }
  }

  const sessionToken = await createSessionCookieValue(userId, {
    ipAddress: c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip"),
    userAgent: c.req.header("user-agent"),
    authenticationMethod: authMethod,
    identityProviderId: provider.id,
  });
  setCookie(c, SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    secure: isSecureDeployment(),
    sameSite: "Lax",
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
  });

  await prisma.identityProvider.update({
    where: { id: provider.id },
    data: { ssoTestedAt: new Date() },
  });
  await recordAuditEvent({
    organizationId: provider.organizationId,
    actorId: userId,
    eventType: "USER_LOGIN",
    metadata: { authenticationMethod: authMethod, identityProviderId: provider.id },
  });
  return c.redirect(new URL(safeRedirectPath(redirectTo), appUrl()).toString());
}

function ssoErrorRedirect(reason: string): Response {
  const url = new URL("/onboarding", appUrl());
  url.searchParams.set("authError", `sso-${reason}`);
  return new Response(null, { status: 303, headers: { Location: url.toString() } });
}

export function registerSsoAuthRoutes(app: import("hono").Hono<AppEnv>): void {
  app.get("/api/auth/sso/providers", async (c) => {
    const organizationSlug = c.req.query("organization");
    if (!organizationSlug) return c.json({ data: [], error: null });
    const organization = await prisma.organization.findUnique({
      where: { slug: organizationSlug },
      select: { id: true },
    });
    if (!organization) return c.json({ data: [], error: null });
    const providers = await prisma.identityProvider.findMany({
      where: { organizationId: organization.id, enabled: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, type: true },
    });
    return c.json({ data: providers, error: null });
  });

  app.get("/api/auth/sso/start", async (c) => {
    if (!isSecureDeployment()) return ssoErrorRedirect("https-required");
    const organizationSlug = c.req.query("organization");
    if (!organizationSlug) return ssoErrorRedirect("failed");

    const organization = await prisma.organization.findUnique({
      where: { slug: organizationSlug },
      select: { id: true },
    });
    if (!organization) return ssoErrorRedirect("failed");

    const requestedProviderId = c.req.query("provider");
    const providers = await prisma.identityProvider.findMany({
      where: {
        organizationId: organization.id,
        enabled: true,
        ...(requestedProviderId ? { id: requestedProviderId } : {}),
      },
      orderBy: { createdAt: "asc" },
      include: { organization: { select: { id: true, slug: true, ssoEnforced: true } } },
    });
    if (providers.length !== 1) return ssoErrorRedirect("provider-selection-required");
    const provider = providers[0];
    if (!provider) return ssoErrorRedirect("failed");

    const redirectTo = safeRedirectPath(c.req.query("redirectTo"));
    const state = randomState();
    const sameSite = provider.type === "SAML" ? "None" : "Lax";
    await createTransaction(provider, state, redirectTo);
    setCookie(c, getStateCookieName(provider.id), state, safeCookieOptions(sameSite));

    if (provider.type === "OIDC") {
      try {
        if (!provider.issuer || !provider.clientId || !provider.clientSecretEncrypted) {
          return ssoErrorRedirect("configuration");
        }
        const codeVerifier = randomPKCECodeVerifier();
        const nonce = randomNonce();
        await prisma.ssoTransaction.update({
          where: { stateHash: hash(state) },
          data: { codeVerifier, nonce },
        });
        const config = await loadOidcConfiguration(provider);
        const challenge = await calculatePKCECodeChallenge(codeVerifier);
        const destination = buildAuthorizationUrl(config, {
          redirect_uri: `${appUrl()}/api/auth/sso/oidc/callback`,
          scope: "openid email profile",
          response_type: "code",
          state,
          nonce,
          code_challenge: challenge,
          code_challenge_method: "S256",
        });
        return c.redirect(destination.toString());
      } catch (error) {
        console.error("[sso] OIDC authorization setup failed", {
          providerId: provider.id,
          errorType: error instanceof Error ? error.name : "unknown",
        });
        return ssoErrorRedirect("configuration");
      }
    }

    try {
      const saml = getSamlConfiguration(provider);
      const destination = await saml.getAuthorizeUrlAsync(state, undefined, {
        samlFallback: "login-request",
      });
      return c.redirect(destination);
    } catch (error) {
      console.error("[sso] SAML authorization setup failed", {
        providerId: provider.id,
        errorType: error instanceof Error ? error.name : "unknown",
      });
      return ssoErrorRedirect("configuration");
    }
  });

  app.get("/api/auth/sso/oidc/callback", async (c) => {
    const state = c.req.query("state");
    if (!state) return ssoErrorRedirect("failed");
    const consumed = await consumeTransaction(c, state, "OIDC");
    if (!consumed) return ssoErrorRedirect("expired");
    const { transaction, provider } = consumed;

    try {
      if (!transaction.codeVerifier || !transaction.nonce) {
        return ssoErrorRedirect("failed");
      }
      const config = await loadOidcConfiguration(provider);
      const callbackUrl = new URL(`${appUrl()}/api/auth/sso/oidc/callback`);
      callbackUrl.search = new URL(c.req.url).search;
      const tokens = await authorizationCodeGrant(config, callbackUrl, {
        expectedState: state,
        expectedNonce: transaction.nonce,
        pkceCodeVerifier: transaction.codeVerifier,
      });
      if (!tokens.access_token) return ssoErrorRedirect("failed");
      const claims = tokens.claims();
      if (!claims?.sub) return ssoErrorRedirect("failed");
      const userInfo = await fetchUserInfo(config, tokens.access_token, claims.sub);
      if (
        userInfo.sub !== claims.sub ||
        userInfo.email_verified !== true ||
        typeof userInfo.email !== "string" ||
        !userInfo.email.trim()
      ) {
        return ssoErrorRedirect("failed");
      }
      return await establishFederatedSession(
        c,
        provider,
        {
          subject: claims.sub,
          email: userInfo.email,
          name: userInfo.name,
        },
        "OIDC",
        transaction.redirectTo,
      );
    } catch (error) {
      console.error("[sso] OIDC callback validation failed", {
        providerId: provider.id,
        errorType: error instanceof Error ? error.name : "unknown",
      });
      return ssoErrorRedirect("failed");
    }
  });

  app.post("/api/auth/sso/saml/callback", async (c) => {
    const form = await c.req.parseBody();
    const state = typeof form["RelayState"] === "string" ? form["RelayState"] : "";
    if (!state || typeof form["SAMLResponse"] !== "string") {
      return ssoErrorRedirect("failed");
    }
    const consumed = await consumeTransaction(c, state, "SAML");
    if (!consumed) return ssoErrorRedirect("expired");
    const { transaction, provider } = consumed;

    try {
      const saml = getSamlConfiguration(provider);
      const result = await saml.validatePostResponseAsync({
        SAMLResponse: form["SAMLResponse"],
        RelayState: state,
      });
      if (!result.profile || result.loggedOut) return ssoErrorRedirect("failed");
      const emailAttribute = stringProperty(provider.metadata, "emailAttribute");
      const nameAttribute = stringProperty(provider.metadata, "nameAttribute");
      const email = extractSamlValue(result.profile, emailAttribute);
      const name = nameAttribute ? extractSamlValue(result.profile, nameAttribute) : undefined;
      if (!email) return ssoErrorRedirect("failed");
      return await establishFederatedSession(
        c,
        provider,
        { subject: result.profile.nameID, email, name },
        "SAML",
        transaction.redirectTo,
      );
    } catch (error) {
      console.error("[sso] SAML callback validation failed", {
        providerId: provider.id,
        errorType: error instanceof Error ? error.name : "unknown",
      });
      return ssoErrorRedirect("failed");
    }
  });

  app.get("/api/auth/sso/saml/metadata/:providerId", async (c) => {
    const provider = await getProvider(c.req.param("providerId"), false);
    if (!provider || provider.type !== "SAML") {
      return c.text("Not found", 404);
    }
    try {
      const saml = getSamlConfiguration(provider);
      return c.body(saml.generateServiceProviderMetadata(null), 200, {
        "Content-Type": "application/samlmetadata+xml; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      });
    } catch (error) {
      console.error("[sso] SAML metadata generation failed", {
        providerId: provider.id,
        errorType: error instanceof Error ? error.name : "unknown",
      });
      return c.text("SAML provider is not configured", 503);
    }
  });
}
