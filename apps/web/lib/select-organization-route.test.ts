import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../app/api/select-organization/route";

describe("organization selection route", () => {
  it("redirects to a relative path so the browser stays on its current host", async () => {
    const request = new NextRequest("http://0.0.0.0:3000/api/select-organization?org=org-123");

    const response = await GET(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/dashboard");
    expect(response.headers.get("set-cookie")).toContain("ai_sdlc_selected_org=org-123");
  });

  it("allows only same-site path redirects", async () => {
    const internalPath = await GET(
      new NextRequest(
        "http://0.0.0.0:3000/api/select-organization?org=org-123&redirectTo=%2Fdashboard%2Fsettings%3Ftab%3Dteam",
      ),
    );
    const externalUrl = await GET(
      new NextRequest(
        "http://0.0.0.0:3000/api/select-organization?org=org-123&redirectTo=https%3A%2F%2Fevil.example",
      ),
    );

    expect(internalPath.headers.get("location")).toBe("/dashboard/settings?tab=team");
    expect(externalUrl.headers.get("location")).toBe("/dashboard");
  });
});
