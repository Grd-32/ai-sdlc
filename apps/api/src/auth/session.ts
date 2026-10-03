/**
 * Session cookie helpers (Milestone A).
 *
 * Cookies carry an opaque token backed by a revocable server-side Session row.
 * See packages/db/src/sessions.ts for storage and revocation semantics.
 */

import { randomBytes } from "node:crypto";
import {
  createSession,
  revokeSession,
  revokeAllUserSessions,
  verifySessionToken,
  SESSION_TTL_SECONDS,
} from "@ai-sdlc/db";

export const SESSION_COOKIE = "ai_sdlc_session";
export { SESSION_TTL_SECONDS };

export interface SessionPayload {
  userId: string;
}

export async function createSessionCookieValue(
  userId: string,
  meta?: { ipAddress?: string; userAgent?: string },
): Promise<string> {
  const { token } = await createSession({ userId, ...meta });
  return token;
}

export async function verifySessionCookieValue(
  cookieValue: string | undefined | null,
): Promise<SessionPayload | null> {
  const session = await verifySessionToken(cookieValue);
  if (!session) {
    return null;
  }
  return { userId: session.userId };
}

export async function revokeSessionCookieValue(cookieValue: string | undefined | null): Promise<void> {
  if (cookieValue) {
    await revokeSession(cookieValue);
  }
}

export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  await revokeAllUserSessions(userId);
}

export function generateOAuthState(): string {
  return randomBytes(24).toString("base64url");
}
