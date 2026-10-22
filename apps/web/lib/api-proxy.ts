import type { NextRequest } from "next/server";

const RESPONSE_HEADERS = [
  "cache-control",
  "content-disposition",
  "content-type",
  "location",
] as const;
const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "content-type",
  "cookie",
  "user-agent",
  "x-forwarded-for",
  "x-github-event",
  "x-github-delivery",
  "x-hub-signature-256",
  "x-github-hook-id",
  "x-github-hook-installation-target-id",
  "x-github-hook-installation-target-type",
] as const;

export async function proxyApiRequest(
  request: NextRequest,
  apiPath: string,
  additionalHeaders: readonly string[] = [],
): Promise<Response> {
  const apiBaseUrl = process.env["API_INTERNAL_URL"];
  if (!apiBaseUrl) {
    throw new Error("API_INTERNAL_URL is required for same-origin API proxy routes");
  }

  const target = new URL(apiPath, apiBaseUrl);
  target.search = request.nextUrl.search;

  const requestHeaders = new Headers();
  for (const header of new Set([...FORWARDED_REQUEST_HEADERS, ...additionalHeaders])) {
    const value = request.headers.get(header);
    if (value) {
      requestHeaders.set(header, value);
    }
  }

  const upstream = await fetch(target, {
    method: request.method,
    headers: requestHeaders,
    ...(request.method === "GET" || request.method === "HEAD"
      ? {}
      : { body: await request.arrayBuffer() }),
    cache: "no-store",
    redirect: "manual",
  });

  const responseHeaders = new Headers();
  for (const header of RESPONSE_HEADERS) {
    const value = upstream.headers.get(header);
    if (value) {
      responseHeaders.set(header, value);
    }
  }
  for (const cookie of upstream.headers.getSetCookie()) {
    responseHeaders.append("set-cookie", cookie);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
