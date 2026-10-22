import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "../app/api/auth/[...path]/route";

describe("auth proxy route", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env["API_INTERNAL_URL"];
  });

  it("redirects browser logout to the same-site home page and preserves the cleared cookie", async () => {
    process.env["API_INTERNAL_URL"] = "http://api:3001";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { loggedOut: true }, error: null }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "set-cookie": "ai_sdlc_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = new NextRequest("https://web.example.test/api/auth/logout", {
      method: "POST",
      headers: { cookie: "ai_sdlc_session=session-token" },
    });
    const response = await POST(request);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [target, options] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(target.toString()).toBe("http://api:3001/api/auth/logout");
    expect(new Headers(options.headers).get("cookie")).toBe("ai_sdlc_session=session-token");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("routes GitHub installation-update callbacks through installation synchronization", async () => {
    process.env["API_INTERNAL_URL"] = "http://api:3001";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: {
          location: "https://web.example.test/dashboard/repositories?installed=install-1",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = new NextRequest(
      "https://web.example.test/api/auth/github/callback?installation_id=123&state=oauth-state",
      {
        headers: {
          cookie: "ai_sdlc_session=session-token; ai_sdlc_github_installation_org=org-acme",
        },
      },
    );
    const response = await GET(request);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [target, options] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(target.toString()).toBe(
      "http://api:3001/api/github/installations/callback?installation_id=123&state=oauth-state",
    );
    expect(new Headers(options.headers).get("cookie")).toContain(
      "ai_sdlc_github_installation_org=org-acme",
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://web.example.test/dashboard/repositories?installed=install-1",
    );
  });

  it("keeps ordinary GitHub sign-in callbacks on the OAuth handler", async () => {
    process.env["API_INTERNAL_URL"] = "http://api:3001";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 302 }));
    vi.stubGlobal("fetch", fetchMock);

    await GET(
      new NextRequest("https://web.example.test/api/auth/github/callback?code=code&state=state"),
    );

    const [target] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(target.toString()).toBe(
      "http://api:3001/api/auth/github/callback?code=code&state=state",
    );
  });
});
