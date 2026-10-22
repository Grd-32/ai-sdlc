import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../app/api/contact/route";

const validSubmission = {
  name: "Taylor Example",
  email: "taylor@example.test",
  company: "Example Co",
  message: "We would like to discuss a security governance assessment.",
  offer: "enterprise",
  website: "",
};

function request(
  body: Record<string, string>,
  options: { origin?: string; ip?: string; contentType?: string } = {},
) {
  const requestOrigin = "https://site.example.test";
  return new NextRequest(`${requestOrigin}/api/contact`, {
    method: "POST",
    headers: {
      origin: options.origin ?? requestOrigin,
      "content-type": options.contentType ?? "application/json",
      "x-forwarded-for": options.ip ?? "192.0.2.10",
    },
    body: JSON.stringify(body),
  });
}

describe("contact form endpoint", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env["APP_URL"];
    delete process.env["CONTACT_WEBHOOK_URL"];
    delete process.env["CONTACT_WEBHOOK_TOKEN"];
  });

  it("rejects cross-origin requests before delivery", async () => {
    process.env["APP_URL"] = "https://site.example.test";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await POST(request(validSubmission, { origin: "https://attacker.example" }));

    expect(result.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows a local browser origin when the configured callback host is remote", async () => {
    process.env["APP_URL"] = "https://site.example.test";
    const result = await POST(
      request(validSubmission, { origin: "http://localhost:3000", ip: "192.0.2.15" }),
    );

    expect(result.status).toBe(503);
    await expect(result.json()).resolves.toHaveProperty("error");
  });

  it("validates enquiry fields server-side", async () => {
    process.env["APP_URL"] = "https://site.example.test";
    const result = await POST(request({ ...validSubmission, email: "bad-email" }));

    expect(result.status).toBe(400);
    await expect(result.json()).resolves.toEqual({
      error: "Check the name, email, organization, and message fields.",
    });
  });

  it("returns an explicit service error until secure delivery is configured", async () => {
    process.env["APP_URL"] = "https://site.example.test";
    const result = await POST(request(validSubmission, { ip: "192.0.2.11" }));

    expect(result.status).toBe(503);
    await expect(result.json()).resolves.toHaveProperty("error");
  });

  it("forwards valid enquiries to the configured HTTPS endpoint without exposing its token", async () => {
    process.env["APP_URL"] = "https://site.example.test";
    process.env["CONTACT_WEBHOOK_URL"] = "https://intake.example.test/nomalog";
    process.env["CONTACT_WEBHOOK_TOKEN"] = "server-only-token";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await POST(request(validSubmission, { ip: "192.0.2.12" }));

    expect(result.status).toBe(202);
    const [target, options] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(target.toString()).toBe("https://intake.example.test/nomalog");
    expect(new Headers(options.headers).get("authorization")).toBe("Bearer server-only-token");
    expect(JSON.parse(String(options.body))).toMatchObject({
      name: validSubmission.name,
      email: validSubmission.email,
      offer: "enterprise",
    });
  });

  it("rejects non-HTTPS delivery destinations", async () => {
    process.env["APP_URL"] = "https://site.example.test";
    process.env["CONTACT_WEBHOOK_URL"] = "http://intake.example.test/nomalog";
    process.env["CONTACT_WEBHOOK_TOKEN"] = "server-only-token";

    const result = await POST(request(validSubmission, { ip: "192.0.2.13" }));

    expect(result.status).toBe(503);
  });

  it("applies an hourly per-client submission limit", async () => {
    process.env["APP_URL"] = "https://site.example.test";
    process.env["CONTACT_WEBHOOK_URL"] = "https://intake.example.test/nomalog";
    process.env["CONTACT_WEBHOOK_TOKEN"] = "server-only-token";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    const replies = [];
    for (let index = 0; index < 6; index += 1) {
      replies.push(await POST(request(validSubmission, { ip: "192.0.2.14" })));
    }

    expect(replies.slice(0, 5).every((reply) => reply.status === 202)).toBe(true);
    expect(replies[5]?.status).toBe(429);
  });
});
