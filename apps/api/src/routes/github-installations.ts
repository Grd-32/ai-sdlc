/**
 * GitHub App installation setup-URL callback.
 *
 * Configure this exact path as the App's "Setup URL" in its settings
 * (Advanced or General, depending on GitHub's current UI), with "Redirect
 * on update" checked so it also fires when permissions change:
 *
 *   http://localhost:3001/api/github/installations/callback   (dev)
 *
 * Flow: the dashboard links to
 *   https://github.com/apps/<slug>/installations/new?state=<organizationId>
 * GitHub does the install, then redirects the browser back here with
 * installation_id + the same state param echoed back. This is what makes
 * the org linking real (previously done by hand via psql during Phase 12
 * testing) — the organizationId comes from a logged-in user's own browser
 * session, verified against real membership, not trusted blindly from the
 * query string.
 */

import type { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { prisma, ensureOrganizationAccess, recordAuditEvent } from "@ai-sdlc/db";
import { getInstallationDetails } from "@ai-sdlc/github";
import { SESSION_COOKIE, verifySessionCookieValue } from "../auth/session.js";
import type { AppEnv } from "../types.js";

export function registerGitHubInstallationRoutes(app: Hono<AppEnv>): void {
  app.get("/api/github/installations/callback", async (c) => {
    const appUrl = process.env["APP_URL"] ?? "http://localhost:3000";
    const session = verifySessionCookieValue(getCookie(c, SESSION_COOKIE));

    if (!session) {
      // Not logged in — send through login first, then straight back here
      // with the exact same query string so installation_id/state survive.
      const search = new URL(c.req.url).search;
      const returnTo = `/api/github/installations/callback${search}`;
      return c.redirect(`/api/auth/github/login?redirectTo=${encodeURIComponent(returnTo)}`);
    }

    const installationId = c.req.query("installation_id");
    const organizationId = c.req.query("state");

    if (!installationId) {
      return c.redirect(`${appUrl}/dashboard/repositories?installError=missing_installation_id`);
    }
    if (!organizationId) {
      return c.redirect(`${appUrl}/dashboard/repositories?installError=missing_organization`);
    }

    // Never trust organizationId from the query string alone — require the
    // logged-in user actually be an admin of that org. ADMIN (not VIEWER),
    // since connecting a GitHub installation is a significant, security-
    // relevant action (README §47/§92: never trust a client-supplied
    // organizationId without verifying membership — this applies the same
    // way here as it does to every dashboard API route).
    try {
      await ensureOrganizationAccess({
        prisma,
        userId: session.userId,
        organizationId,
        minimumRole: "ADMIN",
      });
    } catch {
      return c.redirect(`${appUrl}/dashboard/repositories?installError=forbidden`);
    }

    let details;
    try {
      details = await getInstallationDetails(installationId);
    } catch (error) {
      console.error("[github-installations] failed to fetch installation details:", error);
      return c.redirect(`${appUrl}/dashboard/repositories?installError=github_fetch_failed`);
    }

    const installation = await prisma.gitHubInstallation.upsert({
      where: { githubInstallationId: installationId },
      update: {
        organizationId,
        accountLogin: details.account?.login,
        accountType: details.account?.type,
        permissions: details.permissions,
        active: true,
      },
      create: {
        organizationId,
        githubInstallationId: installationId,
        accountLogin: details.account?.login,
        accountType: details.account?.type,
        permissions: details.permissions,
        active: true,
      },
    });

    await recordAuditEvent({
      organizationId,
      eventType: "GITHUB_INSTALLATION_CREATED",
      actorId: session.userId,
      metadata: { githubInstallationId: installationId, accountLogin: details.account?.login },
    });

    return c.redirect(`${appUrl}/dashboard/repositories?installed=${installation.id}`);
  });
}