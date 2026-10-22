import { NextRequest, NextResponse } from "next/server";
import { SELECTED_ORG_COOKIE } from "@/lib/api";

/**
 * Sets the selected-org cookie and redirects back. UI convenience only —
 * see the comment on getSelectedOrganization() in lib/api.ts for why this
 * doesn't need to re-verify membership itself.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const orgId = request.nextUrl.searchParams.get("org");
  const requestedRedirect = request.nextUrl.searchParams.get("redirectTo");
  const redirectTo = getSafeRedirectPath(requestedRedirect);

  const response = new NextResponse(null, {
    status: 307,
    headers: { Location: redirectTo },
  });

  if (orgId) {
    response.cookies.set(SELECTED_ORG_COOKIE, orgId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  return response;
}

function getSafeRedirectPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/dashboard";
  }

  const target = new URL(value, "http://nomalog.invalid");
  if (target.origin !== "http://nomalog.invalid") {
    return "/dashboard";
  }

  return `${target.pathname}${target.search}${target.hash}`;
}
