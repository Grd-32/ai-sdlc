/**
 * Server-side session management (Milestone A).
 *
 * Replaces stateless-only cookies with revocable DB-backed sessions.
 * The cookie carries an opaque token; only a SHA-256 hash is stored.
 */

import { createHash, randomBytes } from "node:crypto";
import { prisma } from "./index.js";

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export interface CreateSessionParams {
  userId: string;
  ipAddress?: string;
  userAgent?: string;
  ttlSeconds?: number;
}

export async function createSession(
  params: CreateSessionParams,
): Promise<{ token: string; sessionId: string }> {
  const token = generateSessionToken();
  const ttl = params.ttlSeconds ?? SESSION_TTL_SECONDS;
  const expiresAt = new Date(Date.now() + ttl * 1000);

  const session = await prisma.session.create({
    data: {
      userId: params.userId,
      tokenHash: hashToken(token),
      expiresAt,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    },
  });

  return { token, sessionId: session.id };
}

export interface ValidSession {
  sessionId: string;
  userId: string;
}

/** Returns null if token is invalid, expired, or revoked. */
export async function verifySessionToken(
  token: string | undefined | null,
): Promise<ValidSession | null> {
  if (!token || token.trim().length === 0) {
    return null;
  }

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, userId: true, expiresAt: true, revokedAt: true },
  });

  if (!session || session.revokedAt) {
    return null;
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { active: true },
  });

  if (!user?.active) {
    return null;
  }

  return { sessionId: session.id, userId: session.userId };
}

export async function revokeSession(token: string): Promise<void> {
  await prisma.session.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Revoke all sessions for a user ("sign out everywhere"). */
export async function revokeAllUserSessions(userId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
