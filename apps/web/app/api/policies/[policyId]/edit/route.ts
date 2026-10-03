import { NextRequest, NextResponse } from "next/server";
import { mutateApi } from "@/lib/api";

function redirectOrigin(request: NextRequest): string {
  // See the note in app/api/policies/route.ts — request.url can reflect the
  // container's own bind address (HOSTNAME=0.0.0.0) rather than what the
  // browser actually connected to. The Host header is reliable.
  return `http://${request.headers.get("host") ?? "localhost:3000"}`;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ policyId: string }> },
): Promise<NextResponse> {
  const { policyId } = await params;
  const formData = await request.formData();
  const organizationId = String(formData.get("organizationId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();

  const redirectUrl = new URL("/dashboard/policies", redirectOrigin(request));

  if (!organizationId || !name) {
    redirectUrl.searchParams.set("policyError", "Name is required.");
    return NextResponse.redirect(redirectUrl);
  }

  const result = await mutateApi(`/api/organizations/${organizationId}/policies/${policyId}`, "PATCH", {
    name,
    description,
  });

  if (!result.ok) {
    redirectUrl.searchParams.set("policyError", result.error?.message ?? "Failed to update policy.");
  }

  return NextResponse.redirect(redirectUrl);
}