import type { NextRequest } from "next/server";
import { proxyApiRequest } from "@/lib/api-proxy";

export function GET(request: NextRequest): Promise<Response> {
  return proxyApiRequest(request, "/api/github/installations/callback");
}
