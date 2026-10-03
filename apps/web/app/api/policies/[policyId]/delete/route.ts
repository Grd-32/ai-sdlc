import { NextRequest, NextResponse } from "next/server";
import { mutateApi } from "@/lib/api";

function redirectOrigin(request: NextRequest): string {
  return `http://${request.headers.get("host") ?? "localhost:3000"}`;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ policyId: string }> },
): Promise<NextResponse> {
  const { policyId } = await params;
  const formData = await request.formData();
  const organizationId = String(formData.get("organizationId") ?? "");

  const redirectUrl = new URL("/dashboard/policies", redirectOrigin(request));

  if (!organizationId) {
    redirectUrl.searchParams.set("policyError", "Missing organization context.");
    return NextResponse.redirect(redirectUrl);
  }

  const result = await mutateApi(`/api/organizations/${organizationId}/policies/${policyId}`, "DELETE");

  if (!result.ok) {
    redirectUrl.searchParams.set("policyError", result.error?.message ?? "Failed to delete policy.");
  }

  return NextResponse.redirect(redirectUrl);
}