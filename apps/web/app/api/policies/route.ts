import { NextRequest, NextResponse } from "next/server";
import { mutateApi } from "@/lib/api";

function redirectOrigin(request: NextRequest): string {
  // Don't use request.url as the redirect base — inside the container
  // (HOSTNAME=0.0.0.0 per the Dockerfile), Next.js's standalone server can
  // reflect its own bind address there instead of what the browser actually
  // connected to. The Host header reliably carries the real value
  // (localhost:3000) since that's what the browser sent.
  return `http://${request.headers.get("host") ?? "localhost:3000"}`;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const formData = await request.formData();
  const organizationId = String(formData.get("organizationId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();

  const redirectUrl = new URL("/dashboard/policies", redirectOrigin(request));

  if (!organizationId || !name) {
    redirectUrl.searchParams.set("policyError", "Name is required.");
    return NextResponse.redirect(redirectUrl);
  }

  const result = await mutateApi(`/api/organizations/${organizationId}/policies`, "POST", {
    name,
    description: description || undefined,
  });

  if (!result.ok) {
    redirectUrl.searchParams.set("policyError", result.error?.message ?? "Failed to create policy.");
  }

  return NextResponse.redirect(redirectUrl);
}