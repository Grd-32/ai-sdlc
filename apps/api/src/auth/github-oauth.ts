// /**
//  * "Sign in with GitHub" — user-to-server OAuth using the GitHub App's own
//  * client_id/client_secret (getGitHubAppConfig(), already used for the App's
//  * server-to-server installation auth). GitHub Apps support this natively —
//  * enable "Request user authorization (OAuth) during installation" in the
//  * App's settings and set its callback URL to match GITHUB_APP_CALLBACK_URL
//  * below. No second OAuth App registration, no duplicate secrets.
//  */

// import type { Hono } from "hono";
// import { getCookie, setCookie, deleteCookie } from "hono/cookie";
// import { prisma, recordAuditEvent } from "@ai-sdlc/db";
// import { getGitHubAppConfig } from "@ai-sdlc/github";
// import {
//   createSessionCookieValue,
//   generateOAuthState,
//   SESSION_COOKIE,
//   SESSION_TTL_SECONDS,
//   verifySessionCookieValue,
// } from "./session.js";
// import type { AppEnv } from "../types.js";

// const OAUTH_STATE_COOKIE = "ai_sdlc_oauth_state";
// const OAUTH_REDIRECT_COOKIE = "ai_sdlc_oauth_redirect";
// const DEFAULT_REDIRECT_PATH = "/dashboard";
// const isProduction = process.env["NODE_ENV"] === "production";

// function getOAuthRuntimeConfig() {
//   const { clientId, clientSecret } = getGitHubAppConfig();
//   const callbackUrl = process.env["GITHUB_APP_CALLBACK_URL"];
//   const appUrl = process.env["APP_URL"] ?? "http://localhost:3000";

//   if (!clientId || !clientSecret || !callbackUrl) {
//     throw new Error(
//       "GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET and GITHUB_APP_CALLBACK_URL are required for GitHub sign-in",
//     );
//   }

//   return { clientId, clientSecret, callbackUrl, appUrl };
// }

// /**
//  * Only ever allow a same-site relative path. Rejects anything that could be
//  * used as an open redirect (an absolute URL, a protocol-relative "//evil.com"
//  * URL, or a "javascript:" style scheme) — without this check, a crafted
//  * ?redirectTo= on the login link could redirect a user off-site immediately
//  * after a legitimate-looking GitHub login completes.
//  */
// function sanitizeRedirectPath(candidate: string | undefined | null): string {
//   if (!candidate) {
//     return DEFAULT_REDIRECT_PATH;
//   }
//   if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("://")) {
//     return DEFAULT_REDIRECT_PATH;
//   }
//   return candidate;
// }

// export function registerAuthRoutes(app: Hono<AppEnv>): void {
//   app.get("/api/auth/github/login", (c) => {
//     const { clientId, callbackUrl } = getOAuthRuntimeConfig();
//     const state = generateOAuthState();
//     const redirectTo = sanitizeRedirectPath(c.req.query("redirectTo"));

//     setCookie(c, OAUTH_STATE_COOKIE, state, {
//       httpOnly: true,
//       secure: isProduction,
//       sameSite: "Lax",
//       maxAge: 600,
//       path: "/",
//     });

//     setCookie(c, OAUTH_REDIRECT_COOKIE, redirectTo, {
//       httpOnly: true,
//       secure: isProduction,
//       sameSite: "Lax",
//       maxAge: 600,
//       path: "/",
//     });

//     const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
//     authorizeUrl.searchParams.set("client_id", clientId);
//     authorizeUrl.searchParams.set("redirect_uri", callbackUrl);
//     // No `scope` param — GitHub Apps don't use OAuth scopes for user-to-server
//     // auth. What this App can read (e.g. email addresses) is controlled by
//     // the App's own configured Account permissions, not this request.
//     authorizeUrl.searchParams.set("state", state);

//     return c.redirect(authorizeUrl.toString());
//   });

//   app.get("/api/auth/github/callback", async (c) => {
//     const { clientId, clientSecret, callbackUrl, appUrl } = getOAuthRuntimeConfig();

//     const code = c.req.query("code");
//     const state = c.req.query("state");
//     const expectedState = getCookie(c, OAUTH_STATE_COOKIE);
//     const redirectTo = sanitizeRedirectPath(getCookie(c, OAUTH_REDIRECT_COOKIE));
//     deleteCookie(c, OAUTH_STATE_COOKIE, { path: "/" });
//     deleteCookie(c, OAUTH_REDIRECT_COOKIE, { path: "/" });

//     if (!code || !state || !expectedState || state !== expectedState) {
//       return c.json(
//         { data: null, error: { code: "OAUTH_STATE_MISMATCH", message: "Invalid or expired OAuth state" } },
//         400,
//       );
//     }

//     const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
//       method: "POST",
//       headers: { Accept: "application/json", "Content-Type": "application/json" },
//       body: JSON.stringify({
//         client_id: clientId,
//         client_secret: clientSecret,
//         code,
//         redirect_uri: callbackUrl,
//       }),
//     }).catch(() => null);

//     if (!tokenResponse || !tokenResponse.ok) {
//       return c.json(
//         { data: null, error: { code: "OAUTH_TOKEN_REQUEST_FAILED", message: "GitHub token exchange failed" } },
//         502,
//       );
//     }

//     const tokenData = (await tokenResponse.json()) as { access_token?: string; error?: string };
//     if (!tokenData.access_token) {
//       return c.json(
//         {
//           data: null,
//           error: { code: "OAUTH_TOKEN_REQUEST_FAILED", message: tokenData.error ?? "No access token returned" },
//         },
//         400,
//       );
//     }

//     const authHeaders = {
//       Authorization: `Bearer ${tokenData.access_token}`,
//       Accept: "application/vnd.github+json",
//     };

//     const [userResponse, emailsResponse] = await Promise.all([
//       fetch("https://api.github.com/user", { headers: authHeaders }),
//       fetch("https://api.github.com/user/emails", { headers: authHeaders }),
//     ]);

//     if (!userResponse.ok) {
//       return c.json(
//         { data: null, error: { code: "OAUTH_PROFILE_FETCH_FAILED", message: "Failed to fetch GitHub profile" } },
//         502,
//       );
//     }

//     const githubUser = (await userResponse.json()) as {
//       id: number;
//       login: string;
//       name?: string | null;
//       avatar_url?: string | null;
//       email?: string | null;
//     };

//     let primaryEmail = githubUser.email ?? null;
//     if (!primaryEmail && emailsResponse.ok) {
//       const emails = (await emailsResponse.json()) as Array<{ email: string; primary: boolean; verified: boolean }>;
//       primaryEmail = emails.find((e) => e.primary && e.verified)?.email ?? emails.find((e) => e.verified)?.email ?? null;
//     }

//     if (!primaryEmail) {
//       return c.json(
//         {
//           data: null,
//           error: {
//             code: "OAUTH_EMAIL_REQUIRED",
//             message: "Your GitHub account has no accessible verified email address.",
//           },
//         },
//         400,
//       );
//     }

//     const githubUserId = String(githubUser.id);

//     const user = await prisma.user.upsert({
//       where: { githubUserId },
//       update: {
//         email: primaryEmail,
//         name: githubUser.name ?? githubUser.login,
//         avatarUrl: githubUser.avatar_url ?? null,
//         username: githubUser.login,
//       },
//       create: {
//         githubUserId,
//         username: githubUser.login,
//         email: primaryEmail,
//         name: githubUser.name ?? githubUser.login,
//         avatarUrl: githubUser.avatar_url ?? null,
//       },
//     });

//     setCookie(c, SESSION_COOKIE, createSessionCookieValue(user.id), {
//       httpOnly: true,
//       secure: isProduction,
//       sameSite: "Lax",
//       maxAge: SESSION_TTL_SECONDS,
//       path: "/",
//     });

//     // Phase 14: audit logging. No organizationId — a login isn't scoped to
//     // one organization (the user may belong to zero, one, or several).
//     await recordAuditEvent({
//       eventType: "USER_LOGIN",
//       actorId: user.id,
//       metadata: { githubUserId, username: githubUser.login },
//     });

//     return c.redirect(`${appUrl}${redirectTo}`);
//   });

//   app.post("/api/auth/logout", (c) => {
//     deleteCookie(c, SESSION_COOKIE, { path: "/" });
//     return c.json({ data: { loggedOut: true }, error: null });
//   });

//   app.get("/api/auth/me", async (c) => {
//     const session = verifySessionCookieValue(getCookie(c, SESSION_COOKIE));
//     if (!session) {
//       return c.json({ data: null, error: { code: "UNAUTHENTICATED", message: "Not signed in" } }, 401);
//     }

//     const user = await prisma.user.findUnique({
//       where: { id: session.userId },
//       select: { id: true, email: true, name: true, avatarUrl: true, username: true },
//     });

//     if (!user) {
//       return c.json({ data: null, error: { code: "UNAUTHENTICATED", message: "Session user no longer exists" } }, 401);
//     }

//     return c.json({ data: user, error: null });
//   });
// }
/**
 * "Sign in with GitHub" — user-to-server OAuth using the GitHub App's own
 * client_id/client_secret (getGitHubAppConfig(), already used for the App's
 * server-to-server installation auth). GitHub Apps support this natively —
 * enable "Request user authorization (OAuth) during installation" in the
 * App's settings and set its callback URL to match GITHUB_APP_CALLBACK_URL
 * below. No second OAuth App registration, no duplicate secrets.
 */

import type { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { prisma, recordAuditEvent } from "@ai-sdlc/db";
import { getGitHubAppConfig } from "@ai-sdlc/github";
import {
  createSessionCookieValue,
  generateOAuthState,
  revokeSessionCookieValue,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  verifySessionCookieValue,
} from "./session.js";
import type { AppEnv } from "../types.js";

const OAUTH_STATE_COOKIE = "ai_sdlc_oauth_state";
const OAUTH_REDIRECT_COOKIE = "ai_sdlc_oauth_redirect";
const DEFAULT_REDIRECT_PATH = "/dashboard";
const isProduction = process.env["NODE_ENV"] === "production";

function getOAuthRuntimeConfig() {
  const { clientId, clientSecret } = getGitHubAppConfig();
  const callbackUrl = process.env["GITHUB_APP_CALLBACK_URL"];
  const appUrl = process.env["APP_URL"] ?? "http://localhost:3000";

  if (!clientId || !clientSecret || !callbackUrl) {
    throw new Error(
      "GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET and GITHUB_APP_CALLBACK_URL are required for GitHub sign-in",
    );
  }

  return { clientId, clientSecret, callbackUrl, appUrl };
}

/**
 * Only ever allow a same-site relative path. Rejects anything that could be
 * used as an open redirect (an absolute URL, a protocol-relative "//evil.com"
 * URL, or a "javascript:" style scheme).
 */
function sanitizeRedirectPath(candidate: string | undefined | null): string {
  if (!candidate) {
    return DEFAULT_REDIRECT_PATH;
  }
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("://")) {
    return DEFAULT_REDIRECT_PATH;
  }
  return candidate;
}

export function registerAuthRoutes(app: Hono<AppEnv>): void {
  app.get("/api/auth/github/login", (c) => {
    const { clientId, callbackUrl } = getOAuthRuntimeConfig();
    const state = generateOAuthState();
    const redirectTo = sanitizeRedirectPath(c.req.query("redirectTo"));

    setCookie(c, OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "Lax",
      maxAge: 600,
      path: "/",
    });

    setCookie(c, OAUTH_REDIRECT_COOKIE, redirectTo, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "Lax",
      maxAge: 600,
      path: "/",
    });

    const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("redirect_uri", callbackUrl);
    // No `scope` param — GitHub Apps don't use OAuth scopes for user-to-server
    // auth. What this App can read (e.g. email addresses) is controlled by
    // the App's own configured Account permissions, not this request.
    authorizeUrl.searchParams.set("state", state);

    return c.redirect(authorizeUrl.toString());
  });

  app.get("/api/auth/github/callback", async (c) => {
    const { clientId, clientSecret, callbackUrl, appUrl } = getOAuthRuntimeConfig();

    const code = c.req.query("code");
    const state = c.req.query("state");
    const expectedState = getCookie(c, OAUTH_STATE_COOKIE);
    const redirectTo = sanitizeRedirectPath(getCookie(c, OAUTH_REDIRECT_COOKIE));
    deleteCookie(c, OAUTH_STATE_COOKIE, { path: "/" });
    deleteCookie(c, OAUTH_REDIRECT_COOKIE, { path: "/" });

    if (!code || !state || !expectedState || state !== expectedState) {
      return c.json(
        { data: null, error: { code: "OAUTH_STATE_MISMATCH", message: "Invalid or expired OAuth state" } },
        400,
      );
    }

    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: callbackUrl,
      }),
    }).catch(() => null);

    if (!tokenResponse || !tokenResponse.ok) {
      return c.json(
        { data: null, error: { code: "OAUTH_TOKEN_REQUEST_FAILED", message: "GitHub token exchange failed" } },
        502,
      );
    }

    const tokenData = (await tokenResponse.json()) as { access_token?: string; error?: string };
    if (!tokenData.access_token) {
      return c.json(
        {
          data: null,
          error: { code: "OAUTH_TOKEN_REQUEST_FAILED", message: tokenData.error ?? "No access token returned" },
        },
        400,
      );
    }

    const authHeaders = {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: "application/vnd.github+json",
    };

    const [userResponse, emailsResponse] = await Promise.all([
      fetch("https://api.github.com/user", { headers: authHeaders }),
      fetch("https://api.github.com/user/emails", { headers: authHeaders }),
    ]);

    if (!userResponse.ok) {
      return c.json(
        { data: null, error: { code: "OAUTH_PROFILE_FETCH_FAILED", message: "Failed to fetch GitHub profile" } },
        502,
      );
    }

    const githubUser = (await userResponse.json()) as {
      id: number;
      login: string;
      name?: string | null;
      avatar_url?: string | null;
      email?: string | null;
    };

    let primaryEmail = githubUser.email ?? null;
    if (!primaryEmail && emailsResponse.ok) {
      const emails = (await emailsResponse.json()) as Array<{ email: string; primary: boolean; verified: boolean }>;
      primaryEmail = emails.find((e) => e.primary && e.verified)?.email ?? emails.find((e) => e.verified)?.email ?? null;
    }

    if (!primaryEmail) {
      return c.json(
        {
          data: null,
          error: {
            code: "OAUTH_EMAIL_REQUIRED",
            message: "Your GitHub account has no accessible verified email address.",
          },
        },
        400,
      );
    }

    const githubUserId = String(githubUser.id);

    const user = await prisma.user.upsert({
      where: { githubUserId },
      update: {
        email: primaryEmail,
        name: githubUser.name ?? githubUser.login,
        avatarUrl: githubUser.avatar_url ?? null,
        username: githubUser.login,
      },
      create: {
        githubUserId,
        username: githubUser.login,
        email: primaryEmail,
        name: githubUser.name ?? githubUser.login,
        avatarUrl: githubUser.avatar_url ?? null,
      },
    });

    const sessionToken = await createSessionCookieValue(user.id, {
      ipAddress: c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip"),
      userAgent: c.req.header("user-agent"),
    });

    setCookie(c, SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "Lax",
      maxAge: SESSION_TTL_SECONDS,
      path: "/",
    });

    // Phase 14: audit logging. No organizationId — a login isn't scoped to
    // one organization (the user may belong to zero, one, or several).
    await recordAuditEvent({
      eventType: "USER_LOGIN",
      actorId: user.id,
      metadata: { githubUserId, username: githubUser.login },
    });

    return c.redirect(`${appUrl}${redirectTo}`);
  });

  // GET (not just POST) so Settings can use a plain <a href> link — no
  // client-side JS needed, matches the org-switcher's approach.
  app.get("/api/auth/logout", async (c) => {
    await revokeSessionCookieValue(getCookie(c, SESSION_COOKIE));
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    const appUrl = process.env["APP_URL"] ?? "http://localhost:3000";
    return c.redirect(appUrl);
  });

  app.post("/api/auth/logout", async (c) => {
    await revokeSessionCookieValue(getCookie(c, SESSION_COOKIE));
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ data: { loggedOut: true }, error: null });
  });

  app.get("/api/auth/me", async (c) => {
    const session = await verifySessionCookieValue(getCookie(c, SESSION_COOKIE));
    if (!session) {
      return c.json({ data: null, error: { code: "UNAUTHENTICATED", message: "Not signed in" } }, 401);
    }

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true, email: true, name: true, avatarUrl: true, username: true },
    });

    if (!user) {
      return c.json({ data: null, error: { code: "UNAUTHENTICATED", message: "Session user no longer exists" } }, 401);
    }

    return c.json({ data: user, error: null });
  });
}