import type { NextRequest } from "next/server";

const RESPONSE_HEADERS = ["cache-control", "content-type", "location"] as const;

export async function proxyApiRequest(request: NextRequest, apiPath: string): Promise<Response> {
  const apiBaseUrl = process.env["API_INTERNAL_URL"];
  if (!apiBaseUrl) {
    throw new Error("API_INTERNAL_URL is required for same-origin API proxy routes");
  }

  const target = new URL(apiPath, apiBaseUrl);
  target.search = request.nextUrl.search;

  const requestHeaders = new Headers();
  for (const header of ["accept", "content-type", "cookie", "user-agent", "x-forwarded-for"]) {
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
