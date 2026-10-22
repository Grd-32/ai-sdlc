import { NextRequest, NextResponse } from "next/server";
import { mutateApi } from "@/lib/api";

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { data: null, error: { code: "VALIDATION_ERROR", message: "Request body must be JSON." } },
      { status: 400 },
    );
  }

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      {
        data: null,
        error: { code: "VALIDATION_ERROR", message: "Request body must be an object." },
      },
      { status: 400 },
    );
  }

  const requestData = body as Record<string, unknown>;
  const organizationId =
    typeof requestData["organizationId"] === "string" ? requestData["organizationId"] : "";
  if (!organizationId) {
    return NextResponse.json(
      { data: null, error: { code: "VALIDATION_ERROR", message: "organizationId is required." } },
      { status: 400 },
    );
  }

  const result = await mutateApi(
    `/api/organizations/${encodeURIComponent(organizationId)}/policies/simulate`,
    "POST",
    {
      mode: requestData["mode"],
      limit: requestData["limit"],
    },
  );

  return NextResponse.json(
    { data: result.data, error: result.error },
    { status: result.status ?? 502 },
  );
}
