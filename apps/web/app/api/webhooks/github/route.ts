import type { NextRequest } from "next/server";
import { proxyApiRequest } from "@/lib/api-proxy";

export async function POST(request: NextRequest): Promise<Response> {
  return proxyApiRequest(request, "/api/webhooks/github");
}
