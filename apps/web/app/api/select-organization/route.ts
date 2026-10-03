import { NextRequest, NextResponse } from "next/server";
import { SELECTED_ORG_COOKIE } from "@/lib/api";

/**
 * Sets the selected-org cookie and redirects back. UI convenience only —
 * see the comment on getSelectedOrganization() in lib/api.ts for why this
 * doesn't need to re-verify membership itself.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const orgId = request.nextUrl.searchParams.get("org");
  const redirectTo = request.nextUrl.searchParams.get("redirectTo") ?? "/dashboard";

  const response = NextResponse.redirect(new URL(redirectTo, request.url));

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