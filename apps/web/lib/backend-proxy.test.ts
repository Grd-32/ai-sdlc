import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../app/api/webhooks/github/route";
import { POST as bitbucketWebhook } from "../app/api/webhooks/bitbucket/[connectionId]/route";
import { POST as azureDevOpsWebhook } from "../app/api/webhooks/azure-devops/[connectionId]/route";
import { GET as backendGet } from "../app/api/backend/[...path]/route";

describe("single-domain API proxy", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env["API_INTERNAL_URL"];
  });

  it("forwards signed GitHub webhook headers and exact request body", async () => {
    process.env["API_INTERNAL_URL"] = "http://api:3001";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"data":{"received":true}}', {
        status: 202,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const payload = '{"action":"opened"}';
    const request = new NextRequest("https://stable.ngrok.app/api/webhooks/github", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "pull_request",
        "x-github-delivery": "delivery-id",
        "x-hub-signature-256": "sha256=test-signature",
      },
      body: payload,
    });

    const response = await POST(request);
    const [target, options] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const headers = new Headers(options.headers);

    expect(target.toString()).toBe("http://api:3001/api/webhooks/github");
    expect(headers.get("x-github-event")).toBe("pull_request");
    expect(headers.get("x-github-delivery")).toBe("delivery-id");
    expect(headers.get("x-hub-signature-256")).toBe("sha256=test-signature");
    expect(Buffer.from(options.body as ArrayBuffer).toString()).toBe(payload);
    expect(response.status).toBe(202);
  });

  it("forwards Bitbucket webhook headers and body through the public host", async () => {
    process.env["API_INTERNAL_URL"] = "http://api:3001";
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const request = new NextRequest(
      "https://stable.ngrok.app/api/webhooks/bitbucket/connection-1",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature": "sha256=signature",
          "x-event-key": "pullrequest:created",
          "x-request-uuid": "delivery-uuid",
        },
        body: '{"ok":true}',
      },
    );

    await bitbucketWebhook(request, { params: Promise.resolve({ connectionId: "connection-1" }) });
    const [target, options] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const headers = new Headers(options.headers);

    expect(target.toString()).toBe("http://api:3001/api/webhooks/bitbucket/connection-1");
    expect(headers.get("x-hub-signature")).toBe("sha256=signature");
    expect(headers.get("x-event-key")).toBe("pullrequest:created");
    expect(headers.get("x-request-uuid")).toBe("delivery-uuid");
    expect(Buffer.from(options.body as ArrayBuffer).toString()).toBe('{"ok":true}');
  });

  it("forwards Azure DevOps Basic authorization only on its webhook proxy", async () => {
    process.env["API_INTERNAL_URL"] = "http://api:3001";
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const request = new NextRequest(
      "https://stable.ngrok.app/api/webhooks/azure-devops/connection-1",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Basic service-hook-credentials",
        },
        body: '{"eventType":"servicehook.test"}',
      },
    );

    await azureDevOpsWebhook(request, {
      params: Promise.resolve({ connectionId: "connection-1" }),
    });
    const [target, options] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const headers = new Headers(options.headers);

    expect(target.toString()).toBe("http://api:3001/api/webhooks/azure-devops/connection-1");
    expect(headers.get("authorization")).toBe("Basic service-hook-credentials");
    expect(Buffer.from(options.body as ArrayBuffer).toString()).toBe(
      '{"eventType":"servicehook.test"}',
    );
  });

  it("proxies API requests through the same public origin", async () => {
    process.env["API_INTERNAL_URL"] = "http://api:3001";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"data":[]}', {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const request = new NextRequest(
      "https://stable.ngrok.app/api/backend/api/organizations?include=members",
    );

    const response = await backendGet(request, {
      params: Promise.resolve({ path: ["api", "organizations"] }),
    });
    const [target] = fetchMock.mock.calls[0] as [URL, RequestInit];

    expect(target.toString()).toBe("http://api:3001/api/organizations?include=members");
    expect(response.status).toBe(200);
  });

  it("does not proxy arbitrary paths through the backend route", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const request = new NextRequest("https://stable.ngrok.app/api/backend/something");

    const response = await backendGet(request, {
      params: Promise.resolve({ path: ["something"] }),
    });

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("proxies only the supported health-check paths", async () => {
    process.env["API_INTERNAL_URL"] = "http://api:3001";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const request = new NextRequest("https://stable.ngrok.app/api/backend/health/ready");

    const response = await backendGet(request, {
      params: Promise.resolve({ path: ["health", "ready"] }),
    });
    const [target] = fetchMock.mock.calls[0] as [URL, RequestInit];

    expect(target.toString()).toBe("http://api:3001/health/ready");
    expect(response.status).toBe(200);
  });

  it("rejects extended health-check paths", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const request = new NextRequest("https://stable.ngrok.app/api/backend/health/ready/extra");

    const response = await backendGet(request, {
      params: Promise.resolve({ path: ["health", "ready", "extra"] }),
    });

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
