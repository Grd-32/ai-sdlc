/**
 * GitHub App installation setup-URL callback.
 *
 * Configure the same path through the web application's same-origin proxy
 * as the App's "Setup URL", with "Redirect on update" checked:
 *
 *   https://<public-web-host>/api/github/installations/callback
 *
 * The web proxy forwards the browser session cookie to this API route and
 * keeps the callback on the dashboard's origin.
 *
 * The dashboard first validates the admin's access and sets a short-lived
 * callback context cookie, then starts the GitHub installation with the
 * organization ID in state. The callback accepts that state, the one-time
 * context cookie, or the existing installation's organization and verifies
 * the result against the signed-in user's actual membership.
 */

import type { Hono } from "hono";
import { deleteCookie, getCookie } from "hono/cookie";
import { prisma, ensureOrganizationAccess, recordAuditEvent } from "@ai-sdlc/db";
import { getInstallationDetails, listInstallationRepositories } from "@ai-sdlc/github";
import { SESSION_COOKIE, verifySessionCookieValue } from "../auth/session.js";
import type { AppEnv } from "../types.js";

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export function registerGitHubInstallationRoutes(app: Hono<AppEnv>): void {
  app.get("/api/github/installations/callback", async (c) => {
    const appUrl = process.env["APP_URL"] ?? "http://localhost:3000";
    const session = await verifySessionCookieValue(getCookie(c, SESSION_COOKIE));

    if (!session) {
      // Not logged in — send through login first, then straight back here
      // with the exact same query string so installation_id/state survive.
      const search = new URL(c.req.url).search;
      const returnTo = `/api/github/installations/callback${search}`;
      return c.redirect(`/api/auth/github/login?redirectTo=${encodeURIComponent(returnTo)}`);
    }

    const installationId = c.req.query("installation_id");
    const callbackState = c.req.query("state");
    const contextOrganizationId = getCookie(c, "ai_sdlc_github_installation_org");
    deleteCookie(c, "ai_sdlc_github_installation_org", {
      path: "/api/github/installations/callback",
      secure: appUrl.startsWith("https://"),
      sameSite: "Lax",
    });

    const existingInstallation = installationId
      ? await prisma.gitHubInstallation.findUnique({
          where: { githubInstallationId: installationId },
          select: { organizationId: true },
        })
      : null;
    const organizationId =
      callbackState || contextOrganizationId || existingInstallation?.organizationId;

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
      console.error(
        "[github-installations] failed to fetch installation details:",
        { installationId },
        error,
      );
      return c.redirect(`${appUrl}/dashboard/repositories?installError=github_fetch_failed`);
    }

    const updateData = {
      accountLogin: details.account?.login,
      accountType: details.account?.type,
      permissions: details.permissions,
      active: true,
    };
    const existing = await prisma.gitHubInstallation.findUnique({
      where: { githubInstallationId: installationId },
      select: { id: true, organizationId: true },
    });

    if (existing && existing.organizationId !== organizationId) {
      return c.redirect(
        `${appUrl}/dashboard/repositories?installError=installation_owned_by_another_organization`,
      );
    }

    let installation;
    if (existing) {
      const result = await prisma.gitHubInstallation.updateMany({
        where: { id: existing.id, organizationId },
        data: {
          accountLogin: updateData.accountLogin,
          accountType: updateData.accountType,
          permissions: updateData.permissions,
          active: updateData.active,
        },
      });
      if (result.count !== 1) {
        return c.redirect(
          `${appUrl}/dashboard/repositories?installError=installation_owned_by_another_organization`,
        );
      }
      installation = await prisma.gitHubInstallation.findUniqueOrThrow({
        where: { id: existing.id },
      });
    } else {
      try {
        installation = await prisma.gitHubInstallation.create({
          data: {
            organizationId,
            githubInstallationId: installationId,
            ...updateData,
          },
        });
      } catch (error) {
        if (!isUniqueConstraintError(error)) {
          throw error;
        }

        // A concurrent callback may have created this globally unique
        // installation after the initial lookup. Only update it if it is
        // still owned by the organization verified above.
        const raced = await prisma.gitHubInstallation.findUnique({
          where: { githubInstallationId: installationId },
          select: { id: true, organizationId: true },
        });
        if (!raced) {
          throw error;
        }
        if (raced.organizationId !== organizationId) {
          return c.redirect(
            `${appUrl}/dashboard/repositories?installError=installation_owned_by_another_organization`,
          );
        }

        const result = await prisma.gitHubInstallation.updateMany({
          where: { id: raced.id, organizationId },
          data: {
            accountLogin: updateData.accountLogin,
            accountType: updateData.accountType,
            permissions: updateData.permissions,
            active: updateData.active,
          },
        });
        if (result.count !== 1) {
          return c.redirect(
            `${appUrl}/dashboard/repositories?installError=installation_owned_by_another_organization`,
          );
        }
        installation = await prisma.gitHubInstallation.findUniqueOrThrow({
          where: { id: raced.id },
        });
      }
    }

    await recordAuditEvent({
      organizationId,
      eventType: "GITHUB_INSTALLATION_CREATED",
      actorId: session.userId,
      metadata: { githubInstallationId: installationId, accountLogin: details.account?.login },
    });

    try {
      const repositories = await listInstallationRepositories(installationId);
      const repositoryExternalIds = repositories.map((repository) => String(repository.id));

      await prisma.$transaction(async (tx) => {
        for (const repository of repositories) {
          if (!repository.owner?.login || !repository.name || !repository.id) {
            throw new Error(
              "GitHub returned an installation repository without a stable ID or owner",
            );
          }

          await tx.repository.upsert({
            where: {
              organizationId_provider_owner_name: {
                organizationId,
                provider: "GITHUB",
                owner: repository.owner.login,
                name: repository.name,
              },
            },
            update: {
              githubInstallationId: installation.id,
              externalId: String(repository.id),
              defaultBranch: repository.default_branch ?? null,
              enabled: true,
              metadata: {
                private: repository.private === true,
                source: "github_app_installation_sync",
              },
            },
            create: {
              organizationId,
              githubInstallationId: installation.id,
              provider: "GITHUB",
              externalId: String(repository.id),
              owner: repository.owner.login,
              name: repository.name,
              defaultBranch: repository.default_branch ?? null,
              enabled: true,
              criticality: "MEDIUM",
              metadata: {
                private: repository.private === true,
                source: "github_app_installation_sync",
              },
            },
          });
        }

        await tx.repository.updateMany({
          where: {
            organizationId,
            githubInstallationId: installation.id,
            ...(repositoryExternalIds.length > 0
              ? { externalId: { notIn: repositoryExternalIds } }
              : {}),
          },
          data: { enabled: false },
        });
      });
    } catch (error) {
      console.error("[github-installations] failed to sync installation repositories:", error);
      return c.redirect(`${appUrl}/dashboard/repositories?installError=repository_sync_failed`);
    }

    return c.redirect(`${appUrl}/dashboard/repositories?installed=${installation.id}`);
  });
}
