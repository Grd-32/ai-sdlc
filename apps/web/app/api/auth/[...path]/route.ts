import type { NextRequest } from "next/server";
import { proxyApiRequest } from "@/lib/api-proxy";

const AUTH_PATHS = new Set([
  "/github/login",
  "/github/callback",
  "/gitlab/callback",
  "/bitbucket/callback",
  "/azure-devops/callback",
  "/sso/start",
  "/sso/oidc/callback",
  "/sso/saml/callback",
  "/logout",
]);
const INSTALLATION_ORG_COOKIE = "ai_sdlc_github_installation_org";

async function handleAuthRequest(request: NextRequest): Promise<Response> {
  const path = request.nextUrl.pathname.replace(/^\/api\/auth/, "");
  const isSamlMetadataPath = /^\/sso\/saml\/metadata\/[A-Za-z0-9_-]+$/.test(path);
  if (!AUTH_PATHS.has(path) && !isSamlMetadataPath) {
    return new Response("Not found", { status: 404 });
  }

  if (
    path === "/github/callback" &&
    request.nextUrl.searchParams.has("installation_id") &&
    request.cookies.has(INSTALLATION_ORG_COOKIE)
  ) {
    return proxyApiRequest(request, "/api/github/installations/callback");
  }

  return proxyApiRequest(request, `/api/auth${path}`);
}

export const GET = handleAuthRequest;

export async function POST(request: NextRequest): Promise<Response> {
  const path = request.nextUrl.pathname.replace(/^\/api\/auth/, "");
  const upstream = await handleAuthRequest(request);
  if (path !== "/logout" || !upstream.ok) return upstream;

  const response = new Response(null, {
    status: 303,
    headers: { Location: "/" },
  });
  for (const cookie of upstream.headers.getSetCookie()) {
    response.headers.append("set-cookie", cookie);
  }
  return response;
}
