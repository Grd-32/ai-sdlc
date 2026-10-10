import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";

process.env["DATABASE_URL"] =
  process.env["DATABASE_URL"] ??
  "postgresql://ai_sdlc:ai_sdlc_dev@localhost:5432/ai_sdlc?schema=public";
process.env["REDIS_URL"] = process.env["REDIS_URL"] ?? "redis://localhost:6379";

const { app } = await import("./app.js");

describe("API", () => {
  it("GET /health returns ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { status: string } };
    expect(body.data.status).toBe("ok");
  });

  it("returns generated request and correlation IDs", async () => {
    const res = await app.request("/health");
    const requestId = res.headers.get("x-request-id");

    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers.get("x-correlation-id")).toBe(requestId);
  });

  it("preserves valid request and correlation IDs", async () => {
    const res = await app.request("/health", {
      headers: {
        "x-request-id": "req-123",
        "x-correlation-id": "corr-456",
      },
    });

    expect(res.headers.get("x-request-id")).toBe("req-123");
    expect(res.headers.get("x-correlation-id")).toBe("corr-456");
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
    const deliveryId = `delivery-duplicate-${Date.now()}`;
    const signature = `sha256=${createHmac("sha256", "phase-2-secret")
      .update(payload, "utf8")
      .digest("hex")}`;

    const first = await app.request("/api/webhooks/github", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signature,
        "x-github-event": "pull_request",
        "x-github-delivery": deliveryId,
      },
      body: payload,
    });

    const second = await app.request("/api/webhooks/github", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signature,
        "x-github-event": "pull_request",
        "x-github-delivery": deliveryId,
      },
      body: payload,
    });

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    const firstBody = (await first.json()) as { data: { eventId: string; duplicate: boolean } };
    const secondBody = (await second.json()) as { data: { eventId: string; duplicate: boolean } };
    expect(firstBody.data.duplicate).toBe(false);
    expect(secondBody.data.duplicate).toBe(true);
    expect(secondBody.data.eventId).toBe(firstBody.data.eventId);

    const changedPayload = JSON.stringify({ action: "opened", installation: { id: 99 } });
    const changedSignature = `sha256=${createHmac("sha256", "phase-2-secret")
      .update(changedPayload, "utf8")
      .digest("hex")}`;
    const conflictingReplay = await app.request("/api/webhooks/github", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": changedSignature,
        "x-github-event": "pull_request",
        "x-github-delivery": deliveryId,
      },
      body: changedPayload,
    });
    expect(conflictingReplay.status).toBe(409);
  });

  it("enforces an API rate limit per client", async () => {
    process.env["API_RATE_LIMIT_MAX"] = "2";
    process.env["API_RATE_LIMIT_WINDOW_MS"] = "60000";

    const headers = { "x-forwarded-for": "203.0.113.10" };

    const first = await app.request("/health", { headers });
    const second = await app.request("/health", { headers });
    const third = await app.request("/health", { headers });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
  });

  it("rejects oversized request payloads", async () => {
    process.env["API_REQUEST_MAX_BYTES"] = "32";
    process.env["GITHUB_WEBHOOK_SECRET"] = "phase-2-secret";
    const payload = JSON.stringify({
      action: "opened",
      installation: { id: 42 },
      extra: "x".repeat(128),
    });
    const signature = `sha256=${createHmac("sha256", "phase-2-secret")
      .update(payload, "utf8")
      .digest("hex")}`;

    const res = await app.request("/api/webhooks/github", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(payload)),
        "x-hub-signature-256": signature,
        "x-github-event": "pull_request",
        "x-github-delivery": "delivery-too-large",
      },
      body: payload,
    });

    expect(res.status).toBe(413);
  });
});
