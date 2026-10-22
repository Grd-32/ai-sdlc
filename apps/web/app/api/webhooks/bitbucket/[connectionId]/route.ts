import type { NextRequest } from "next/server";
import { proxyApiRequest } from "@/lib/api-proxy";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
): Promise<Response> {
  const { connectionId } = await params;
  return proxyApiRequest(request, `/api/webhooks/bitbucket/${encodeURIComponent(connectionId)}`, [
    "x-hub-signature",
    "x-event-key",
    "x-request-uuid",
  ]);
}
