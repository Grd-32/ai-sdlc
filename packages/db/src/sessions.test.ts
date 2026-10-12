import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({
  sessionCreate: vi.fn(),
  sessionFindUnique: vi.fn(),
  sessionUpdateMany: vi.fn(),
  userFindUnique: vi.fn(),
}));

vi.mock("./index.js", () => ({
  prisma: {
    session: {
      create: prismaMocks.sessionCreate,
      findUnique: prismaMocks.sessionFindUnique,
      updateMany: prismaMocks.sessionUpdateMany,
    },
    user: { findUnique: prismaMocks.userFindUnique },
  },
}));

import {
  createSession,
  generateSessionToken,
  revokeAllUserSessions,
  revokeSession,
  verifySessionToken,
} from "./sessions.js";

describe("server-side sessions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-09T12:00:00.000Z"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores only a token hash and gives the caller the opaque token", async () => {
    let storedData: { userId: string; tokenHash: string; expiresAt: Date } | undefined;
    prismaMocks.sessionCreate.mockImplementation(
      ({ data }: { data: { userId: string; tokenHash: string; expiresAt: Date } }) => {
        storedData = data;
        return Promise.resolve({ id: "session-1", tokenHash: data.tokenHash });
      },
    );

    const { token, sessionId } = await createSession({ userId: "user-1" });

    expect(sessionId).toBe("session-1");
    expect(token).not.toBe("");
    expect(storedData?.userId).toBe("user-1");
    expect(storedData?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(storedData?.expiresAt).toEqual(new Date("2026-10-16T12:00:00.000Z"));
    expect(storedData?.tokenHash).not.toBe(token);
  });

  it("rejects unknown, revoked, expired, and inactive-user sessions", async () => {
    const now = new Date();
    prismaMocks.sessionFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "revoked",
        userId: "user-1",
        expiresAt: new Date(now.getTime() + 60_000),
        revokedAt: now,
      })
      .mockResolvedValueOnce({
        id: "expired",
        userId: "user-1",
        expiresAt: now,
        revokedAt: null,
      })
      .mockResolvedValueOnce({
        id: "inactive-user",
        userId: "user-1",
        expiresAt: new Date(now.getTime() + 60_000),
        revokedAt: null,
      });
    prismaMocks.userFindUnique.mockResolvedValue({ active: false });

    await expect(verifySessionToken("unknown-token")).resolves.toBeNull();
    await expect(verifySessionToken("revoked-token")).resolves.toBeNull();
    await expect(verifySessionToken("expired-token")).resolves.toBeNull();
    await expect(verifySessionToken("inactive-user-token")).resolves.toBeNull();
    expect(prismaMocks.userFindUnique).toHaveBeenCalledTimes(1);
  });

  it("returns a valid session only for an active user and an unexpired, unrevoked record", async () => {
    prismaMocks.sessionFindUnique.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    });
    prismaMocks.userFindUnique.mockResolvedValue({ active: true });

    await expect(verifySessionToken("valid-token")).resolves.toEqual({
      sessionId: "session-1",
      userId: "user-1",
    });
  });

  it("revokes one session or all active sessions for a user", async () => {
    const updates: Array<{
      where: { tokenHash?: string; userId?: string; revokedAt: null };
      data: { revokedAt: Date };
    }> = [];
    prismaMocks.sessionUpdateMany.mockImplementation(
      (args: {
        where: { tokenHash?: string; userId?: string; revokedAt: null };
        data: { revokedAt: Date };
      }) => {
        updates.push(args);
        return Promise.resolve({ count: 1 });
      },
    );

    await revokeSession("opaque-token");
    await revokeAllUserSessions("user-1");

    expect(updates).toHaveLength(2);
    expect(updates[0]?.where.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(updates[0]?.where.revokedAt).toBeNull();
    expect(updates[1]?.where).toEqual({ userId: "user-1", revokedAt: null });
  });

  it("generates high-entropy URL-safe tokens", () => {
    const token = generateSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
