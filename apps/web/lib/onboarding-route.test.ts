import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../app/api/onboarding/organizations/route";

describe("organization onboarding route", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env["API_INTERNAL_URL"];
    delete process.env["APP_URL"];
  });

  it("accepts the configured public origin behind a reverse proxy", async () => {
    process.env["API_INTERNAL_URL"] = "http://api:3001";
    process.env["APP_URL"] = "https://web.example.test";
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ data: { id: "org-123" }, error: null }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const request = new NextRequest("http://web:3000/api/onboarding/organizations", {
      method: "POST",
      headers: {
        origin: "https://web.example.test",
        cookie: "ai_sdlc_session=session-token",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ name: "Example Org" }),
    });
    const response = await POST(request);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [target, options] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(target.toString()).toBe("http://api:3001/api/organizations");
    expect(options.method).toBe("POST");
    expect(new Headers(options.headers).get("cookie")).toBe("ai_sdlc_session=session-token");
    expect(options.body).toBe(JSON.stringify({ name: "Example Org" }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://web.example.test/dashboard");
    expect(response.headers.getSetCookie().join(";")).toContain("ai_sdlc_selected_org=org-123");
    expect(response.headers.getSetCookie().join(";")).toContain("Secure");
  });

  it("rejects cross-origin submissions", async () => {
    process.env["APP_URL"] = "https://web.example.test";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const request = new NextRequest("http://web:3000/api/onboarding/organizations", {
      method: "POST",
      headers: {
        origin: "https://attacker.example",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ name: "Example Org" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("redirects empty organization names back with a validation message", async () => {
    process.env["APP_URL"] = "http://localhost:3000";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const request = new NextRequest("http://localhost:3000/api/onboarding/organizations", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ name: " " }),
    });

    const response = await POST(request);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/onboarding?error=invalid_name",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
