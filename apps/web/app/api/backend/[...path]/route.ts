import type { NextRequest } from "next/server";
import { proxyApiRequest } from "@/lib/api-proxy";

interface RouteContext {
  params: Promise<{ path: string[] }>;
}

async function handleApiRequest(request: NextRequest, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  const isApiRoute = path[0] === "api" && path.length > 1;
  const isHealthRoute =
    (path.length === 1 && path[0] === "health") ||
    (path.length === 2 && path[0] === "health" && path[1] === "ready");
  if (!isApiRoute && !isHealthRoute) {
    return new Response("Not found", { status: 404 });
  }

  return proxyApiRequest(request, `/${path.join("/")}`);
}

export const GET = handleApiRequest;
export const POST = handleApiRequest;
export const PUT = handleApiRequest;
export const PATCH = handleApiRequest;
export const DELETE = handleApiRequest;
export const HEAD = handleApiRequest;
