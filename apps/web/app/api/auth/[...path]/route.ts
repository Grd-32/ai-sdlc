import type { NextRequest } from "next/server";
import { proxyApiRequest } from "@/lib/api-proxy";

const AUTH_PATHS = new Set(["/github/login", "/github/callback", "/logout"]);

async function handleAuthRequest(request: NextRequest): Promise<Response> {
  const path = request.nextUrl.pathname.replace(/^\/api\/auth/, "");
  if (!AUTH_PATHS.has(path)) {
    return new Response("Not found", { status: 404 });
  }

  return proxyApiRequest(request, `/api/auth${path}`);
}

export const GET = handleAuthRequest;
export const POST = handleAuthRequest;
