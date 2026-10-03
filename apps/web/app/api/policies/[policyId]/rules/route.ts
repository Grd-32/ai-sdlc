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
  const name = String(formData.get("name") ?? "").trim();
  const action = String(formData.get("action") ?? "");
  const aiInvolvedRaw = String(formData.get("aiInvolved") ?? "");
  const riskAtLeastRaw = String(formData.get("riskAtLeast") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const requiredApprovalsRaw = String(formData.get("requiredApprovals") ?? "").trim();

  const sensitiveAreas = formData.getAll("sensitiveAreas").map(String);
  const repositoryCriticalityIn = formData.getAll("repositoryCriticalityIn").map(String);

  const redirectUrl = new URL("/dashboard/policies", redirectOrigin(request));

  if (!organizationId || !name || !action) {
    redirectUrl.searchParams.set("policyError", "Rule name and action are required.");
    return NextResponse.redirect(redirectUrl);
  }

  const body: Record<string, unknown> = {
    name,
    action,
    sensitiveAreas,
    repositoryCriticalityIn,
  };

  if (aiInvolvedRaw === "true") body.aiInvolved = true;
  if (aiInvolvedRaw === "false") body.aiInvolved = false;

  if (riskAtLeastRaw) {
    const parsed = Number(riskAtLeastRaw);
    if (Number.isFinite(parsed)) body.riskAtLeast = parsed;
  }

  if (reason) body.reason = reason;

  if (requiredApprovalsRaw) {
    body.requiredApprovals = requiredApprovalsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const result = await mutateApi(
    `/api/organizations/${organizationId}/policies/${policyId}/rules`,
    "POST",
    body,
  );

  if (!result.ok) {
    redirectUrl.searchParams.set("policyError", result.error?.message ?? "Failed to create rule.");
  }

  return NextResponse.redirect(redirectUrl);
}