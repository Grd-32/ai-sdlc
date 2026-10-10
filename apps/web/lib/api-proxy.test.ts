import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxyApiRequest } from "./api-proxy";

describe("proxyApiRequest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env["API_INTERNAL_URL"];
  });

  it("forwards callback cookies and relays session cookies on the same origin", async () => {
    process.env["API_INTERNAL_URL"] = "http://api:3001";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: {
          Location: "https://github.com/login/oauth/authorize",
          "Set-Cookie": "ai_sdlc_session=session-token; Path=/; HttpOnly; Secure; SameSite=Lax",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = new NextRequest(
      "https://web.example.test/api/auth/github/callback?code=oauth-code&state=oauth-state",
      {
        headers: { cookie: "ai_sdlc_oauth_state=oauth-state" },
      },
    );
    const response = await proxyApiRequest(request, "/api/auth/github/callback");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [target, options] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(target.toString()).toBe(
      "http://api:3001/api/auth/github/callback?code=oauth-code&state=oauth-state",
    );
    expect(new Headers(options.headers).get("cookie")).toBe("ai_sdlc_oauth_state=oauth-state");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://github.com/login/oauth/authorize");
    expect(response.headers.getSetCookie()).toContain(
      "ai_sdlc_session=session-token; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
  });

  it("fails explicitly when the internal API URL is missing", async () => {
    delete process.env["API_INTERNAL_URL"];
    const request = new NextRequest("https://web.example.test/api/auth/github/login");

    await expect(proxyApiRequest(request, "/api/auth/github/login")).rejects.toThrow(
      "API_INTERNAL_URL is required for same-origin API proxy routes",
    );
  });
});
