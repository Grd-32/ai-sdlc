import type { NextRequest } from "next/server";
import { proxyApiRequest } from "@/lib/api-proxy";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
): Promise<Response> {
  const { connectionId } = await params;
  return proxyApiRequest(
    request,
    `/api/webhooks/azure-devops/${encodeURIComponent(connectionId)}`,
    ["authorization"],
  );
}
