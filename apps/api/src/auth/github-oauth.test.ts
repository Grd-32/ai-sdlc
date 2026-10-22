import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../types.js";

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
  userUpdateMany: vi.fn(),
  userCreate: vi.fn(),
  audit: vi.fn(),
  createSessionCookieValue: vi.fn(),
}));

vi.mock("@ai-sdlc/db", () => ({
  prisma: {
    user: {
      findUnique: mocks.userFindUnique,
      update: mocks.userUpdate,
      updateMany: mocks.userUpdateMany,
      create: mocks.userCreate,
    },
  },
  recordAuditEvent: mocks.audit,
}));

vi.mock("@ai-sdlc/github", () => ({
  getGitHubAppConfig: () => ({
    clientId: "client-id",
    clientSecret: "client-secret",
  }),
}));

vi.mock("./session.js", () => ({
  createSessionCookieValue: mocks.createSessionCookieValue,
  generateOAuthState: vi.fn(() => "generated-state"),
  revokeSessionCookieValue: vi.fn(),
  SESSION_COOKIE: "session",
  SESSION_TTL_SECONDS: 3600,
  verifySessionCookieValue: vi.fn(),
}));

const { registerAuthRoutes } = await import("./github-oauth.js");

function createTestApp() {
  const app = new Hono<AppEnv>();
  registerAuthRoutes(app);
  return app;
}

function stubGitHubFetch(email: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL | Request): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/access_token")) {
        return Promise.resolve(Response.json({ access_token: "test-access-token" }));
      }
      if (url.endsWith("/user/emails")) {
        return Promise.resolve(Response.json([{ email, primary: true, verified: true }]));
      }
      return Promise.resolve(Response.json({ id: 42, login: "member", name: "Member" }));
    }),
  );
}

describe("GitHub OAuth recovery", () => {
  beforeEach(() => {
    vi.stubEnv("APP_URL", "https://nomalog.example");
    vi.stubEnv("GITHUB_APP_CALLBACK_URL", "https://api.nomalog.example/api/auth/github/callback");
    vi.stubEnv("NODE_ENV", "test");
    mocks.createSessionCookieValue.mockResolvedValue("session-token");
    mocks.audit.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("returns GitHub authorization denial to an actionable onboarding page", async () => {
    const response = await createTestApp().request(
      "/api/auth/github/callback?error=access_denied&state=oauth-state",
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://nomalog.example/onboarding?authError=cancelled",
    );
    expect(mocks.userCreate).not.toHaveBeenCalled();
  });

  it("returns invalid or expired state to an actionable onboarding page", async () => {
    const response = await createTestApp().request(
      "/api/auth/github/callback?code=oauth-code&state=invalid",
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://nomalog.example/onboarding?authError=expired",
    );
  });

  it("links an invited account only when the verified email is not linked to another GitHub ID", async () => {
    mocks.userFindUnique.mockImplementation(({ where }: { where: Record<string, string> }) => {
      if ("githubUserId" in where) return null;
      if ("email" in where) return { id: "invited-user", githubUserId: null };
      return null;
    });
    mocks.userUpdateMany.mockResolvedValue({ count: 1 });
    stubGitHubFetch("member@example.com");

    const response = await createTestApp().request(
      "/api/auth/github/callback?code=oauth-code&state=oauth-state",
      {
        headers: {
          cookie:
            "ai_sdlc_oauth_state=oauth-state; ai_sdlc_oauth_redirect=%2Fdashboard%2Fassessment",
        },
      },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://nomalog.example/dashboard/assessment");
    expect(response.headers.get("set-cookie")).toContain("session=session-token");
    expect(mocks.userUpdateMany).toHaveBeenCalledWith({
      where: { id: "invited-user", githubUserId: null },
      data: {
        githubUserId: "42",
        username: "member",
        name: "Member",
        avatarUrl: null,
      },
    });
    expect(mocks.userCreate).not.toHaveBeenCalled();
  });

  it("returns an actionable conflict instead of transferring an email linked to another GitHub account", async () => {
    mocks.userFindUnique.mockImplementation(({ where }: { where: Record<string, string> }) => {
      if ("githubUserId" in where) return null;
      if ("email" in where) return { id: "existing-user", githubUserId: "different-github-id" };
      return null;
    });
    stubGitHubFetch("member@example.com");

    const response = await createTestApp().request(
      "/api/auth/github/callback?code=oauth-code&state=oauth-state",
      {
        headers: {
          cookie: "ai_sdlc_oauth_state=oauth-state; ai_sdlc_oauth_redirect=%2Fdashboard",
        },
      },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://nomalog.example/onboarding?authError=account-conflict",
    );
    expect(mocks.createSessionCookieValue).not.toHaveBeenCalled();
    expect(mocks.userCreate).not.toHaveBeenCalled();
  });

  it("keeps a known GitHub identity when its new email belongs to another user", async () => {
    mocks.userFindUnique.mockImplementation(({ where }: { where: Record<string, string> }) => {
      if ("githubUserId" in where) return { id: "known-user", email: "old@example.com" };
      if ("email" in where) return { id: "different-user" };
      return null;
    });
    mocks.userUpdate.mockResolvedValue({ id: "known-user" });
    stubGitHubFetch("new@example.com");

    const response = await createTestApp().request(
      "/api/auth/github/callback?code=oauth-code&state=oauth-state",
      {
        headers: {
          cookie: "ai_sdlc_oauth_state=oauth-state; ai_sdlc_oauth_redirect=%2Fdashboard",
        },
      },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://nomalog.example/dashboard");
    expect(mocks.userUpdate).toHaveBeenCalledWith({
      where: { id: "known-user" },
      data: {
        username: "member",
        name: "Member",
        avatarUrl: null,
        email: "old@example.com",
      },
      select: { id: true },
    });
  });

  it("handles a unique-constraint race with a recovery redirect instead of a 500", async () => {
    mocks.userFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "existing-user", githubUserId: "different-github-id" });
    mocks.userCreate.mockRejectedValue({ code: "P2002" });
    stubGitHubFetch("member@example.com");

    const response = await createTestApp().request(
      "/api/auth/github/callback?code=oauth-code&state=oauth-state",
      {
        headers: {
          cookie: "ai_sdlc_oauth_state=oauth-state; ai_sdlc_oauth_redirect=%2Fdashboard",
        },
      },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://nomalog.example/onboarding?authError=account-conflict",
    );
  });
});
