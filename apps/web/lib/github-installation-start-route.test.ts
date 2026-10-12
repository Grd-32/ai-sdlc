import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../app/api/github/installations/start/route";

describe("GitHub installation start route", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env["API_INTERNAL_URL"];
    delete process.env["APP_URL"];
    delete process.env["NEXT_PUBLIC_GITHUB_APP_SLUG"];
  });

  it("checks admin access, stores callback context, and redirects to GitHub", async () => {
    process.env["API_INTERNAL_URL"] = "http://api:3001";
    process.env["APP_URL"] = "https://web.example.test";
    process.env["NEXT_PUBLIC_GITHUB_APP_SLUG"] = "example-app";
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ data: [], error: null }));
    vi.stubGlobal("fetch", fetchMock);

    const request = new NextRequest(
      "http://web:3000/api/github/installations/start?organizationId=org-123",
      {
        headers: {
          cookie: "ai_sdlc_session=session-token; ai_sdlc_selected_org=org-123",
        },
      },
    );
    const response = await GET(request);
    const location = new URL(response.headers.get("location") ?? "");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [target, options] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(target.toString()).toBe("http://api:3001/api/organizations/org-123/installations");
    expect(new Headers(options.headers).get("cookie")).toContain("ai_sdlc_session=session-token");
    expect(response.status).toBe(307);
    expect(location.origin).toBe("https://github.com");
    expect(location.pathname).toBe("/apps/example-app/installations/new");
    expect(location.searchParams.get("state")).toBe("org-123");
    const callbackCookie = response.headers
      .getSetCookie()
      .find((value) => value.startsWith("ai_sdlc_github_installation_org="));
    expect(callbackCookie).toContain("Path=/api/github/installations/callback");
    expect(callbackCookie).toContain("Secure");
    expect(callbackCookie).toContain("HttpOnly");
  });

  it("does not redirect to GitHub when organization admin access is denied", async () => {
    process.env["API_INTERNAL_URL"] = "http://api:3001";
    process.env["APP_URL"] = "https://web.example.test";
    process.env["NEXT_PUBLIC_GITHUB_APP_SLUG"] = "example-app";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 403 })));

    const request = new NextRequest(
      "https://web.example.test/api/github/installations/start?organizationId=org-123",
      { headers: { cookie: "ai_sdlc_session=session-token" } },
    );
    const response = await GET(request);

    expect(response.headers.get("location")).toBe(
      "https://web.example.test/dashboard/repositories?installError=forbidden",
    );
  });
});
