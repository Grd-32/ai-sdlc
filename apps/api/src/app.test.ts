import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";

process.env["DATABASE_URL"] = process.env["DATABASE_URL"] ?? "postgresql://ai_sdlc:ai_sdlc_dev@localhost:5432/ai_sdlc?schema=public";
process.env["REDIS_URL"] = process.env["REDIS_URL"] ?? "redis://localhost:6379";

const { app } = await import("./app.js");

describe("API", () => {
  it("GET /health returns ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { status: string } };
    expect(body.data.status).toBe("ok");
  });

  it("GET / returns API info", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { name: string } };
    expect(body.data.name).toContain("AI-SDLC");
  });

  it("POST /api/webhooks/github accepts valid signatures", async () => {
    process.env["GITHUB_WEBHOOK_SECRET"] = "phase-2-secret";
    const payload = JSON.stringify({ action: "opened", installation: { id: 42 } });
    const signature = `sha256=${createHmac("sha256", "phase-2-secret")
      .update(payload, "utf8")
      .digest("hex")}`;

    const res = await app.request("/api/webhooks/github", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signature,
        "x-github-event": "pull_request",
        "x-github-delivery": "delivery-123",
      },
      body: payload,
    });

    expect(res.status).toBe(202);
    const body = (await res.json()) as { data: { accepted: boolean; event: string } };
    expect(body.data.accepted).toBe(true);
    expect(body.data.event).toBe("pull_request");
  });

  it("POST /api/webhooks/github rejects invalid signatures", async () => {
    process.env["GITHUB_WEBHOOK_SECRET"] = "phase-2-secret";

    const res = await app.request("/api/webhooks/github", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": "sha256=deadbeef",
        "x-github-event": "pull_request",
      },
      body: JSON.stringify({ ok: false }),
    });

    expect(res.status).toBe(401);
  });

  it("POST /api/webhooks/github accepts duplicate deliveries idempotently", async () => {
    process.env["GITHUB_WEBHOOK_SECRET"] = "phase-2-secret";
    const payload = JSON.stringify({ action: "synchronize", installation: { id: 99 } });
    const signature = `sha256=${createHmac("sha256", "phase-2-secret")
      .update(payload, "utf8")
      .digest("hex")}`;

    const first = await app.request("/api/webhooks/github", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signature,
        "x-github-event": "pull_request",
        "x-github-delivery": "delivery-duplicate",
      },
      body: payload,
    });

    const second = await app.request("/api/webhooks/github", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signature,
        "x-github-event": "pull_request",
        "x-github-delivery": "delivery-duplicate",
      },
      body: payload,
    });

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
  });
});
