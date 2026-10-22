import { NextRequest, NextResponse } from "next/server";
import { mutateApi } from "@/lib/api";

function redirectOrigin(request: NextRequest): string {
  return `http://${request.headers.get("host") ?? "localhost:3000"}`;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const formData = await request.formData();
  const organizationId = String(formData.get("organizationId") ?? "");
  const policyApprovalQuorum = Number(formData.get("policyApprovalQuorum"));
  const redirectUrl = new URL("/dashboard/policies", redirectOrigin(request));

  if (!organizationId || !Number.isInteger(policyApprovalQuorum)) {
    redirectUrl.searchParams.set("policyError", "A valid approval quorum is required.");
    return NextResponse.redirect(redirectUrl);
  }

  const result = await mutateApi(
    `/api/organizations/${organizationId}/settings/policy-approval-quorum`,
    "PATCH",
    { policyApprovalQuorum },
  );
  if (!result.ok) {
    redirectUrl.searchParams.set(
      "policyError",
      result.error?.message ?? "Failed to update the approval quorum.",
    );
  }
  return NextResponse.redirect(redirectUrl);
}
