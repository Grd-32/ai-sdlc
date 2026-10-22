/**
 * Auth + tenant-access middleware.
 *
 * requireOrganizationRole never trusts the :organizationId route param on
 * its own — it's only used to look up membership via ensureOrganizationAccess
 * (packages/db), and the *verified* organizationId from that check (not the
 * raw param) is what downstream route handlers read via c.get("organizationId").
 */

import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import {
  OrganizationAccessError,
  prisma,
  ensureOrganizationAccess,
  authorize,
  type OrganizationRole,
} from "@ai-sdlc/db";
import { SESSION_COOKIE, verifySessionCookieValue } from "../auth/session.js";
import type { AppEnv } from "../types.js";

export async function requireAuth(c: Context<AppEnv>, next: Next): Promise<Response | undefined> {
  const session = await verifySessionCookieValue(getCookie(c, SESSION_COOKIE));
  if (!session) {
    return c.json(
      { data: null, error: { code: "UNAUTHENTICATED", message: "Sign in required" } },
      401,
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, active: true },
  });
  if (!user?.active) {
    return c.json(
      { data: null, error: { code: "UNAUTHENTICATED", message: "Session user no longer exists" } },
      401,
    );
  }

  c.set("userId", user.id);
  c.set("authenticationMethod", session.authenticationMethod);
  c.set("identityProviderId", session.identityProviderId);
  await next();
}

/** Mount only after requireAuth on routes with an :organizationId param. */
export function requireOrganizationRole(minimumRole: OrganizationRole = "VIEWER") {
  return async (c: Context<AppEnv>, next: Next): Promise<Response | undefined> => {
    const userId = c.get("userId");
    const organizationIdParam = c.req.param("organizationId");

    if (!userId) {
      return c.json(
        { data: null, error: { code: "UNAUTHENTICATED", message: "Sign in required" } },
        401,
      );
    }
    if (!organizationIdParam) {
      return c.json(
        {
          data: null,
          error: {
            code: "ORGANIZATION_ID_REQUIRED",
            message: "organizationId route param is required",
          },
        },
        400,
      );
    }

    let access: Awaited<ReturnType<typeof ensureOrganizationAccess>>;
    try {
      access = await ensureOrganizationAccess({
        prisma,
        userId,
        organizationId: organizationIdParam,
        minimumRole,
      });
    } catch (error) {
      if (!(error instanceof OrganizationAccessError)) throw error;
      return c.json(
        {
          data: null,
          error: { code: "FORBIDDEN", message: "You do not have access to this organization" },
        },
        403,
      );
    }

    const organization = await prisma.organization.findUnique({
      where: { id: access.organizationId },
      select: { ssoEnforced: true },
    });
    if (organization?.ssoEnforced) {
      const identityProviderId = c.get("identityProviderId");
      const authenticatedWithOrganizationSso =
        c.get("authenticationMethod") !== "GITHUB" &&
        identityProviderId !== null &&
        (await prisma.identityProvider.findFirst({
          where: {
            id: identityProviderId,
            organizationId: access.organizationId,
            enabled: true,
          },
          select: { id: true },
        })) !== null;
      if (!authenticatedWithOrganizationSso) {
        return c.json(
          {
            data: null,
            error: {
              code: "SSO_REQUIRED",
              message: "Sign in through this organization’s identity provider to continue",
            },
          },
          403,
        );
      }
    }
    c.set("organizationId", access.organizationId);
    c.set("organizationRole", access.role);

    await next();
  };
}

/**
 * Resource-aware authorization after requireOrganizationRole.
 * Example: requirePermission("policy", "write")
 */
export function requirePermission(
  resource: Parameters<typeof authorize>[0]["resource"],
  action: Parameters<typeof authorize>[0]["action"],
) {
  return async (c: Context<AppEnv>, next: Next): Promise<Response | undefined> => {
    const role = c.get("organizationRole");
    const result = authorize({ role, resource, action });
    if (!result.allowed) {
      return c.json({ data: null, error: { code: "FORBIDDEN", message: result.reason } }, 403);
    }

    await next();
  };
}
