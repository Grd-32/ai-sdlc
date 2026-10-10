import { NextRequest, NextResponse } from "next/server";
import { SELECTED_ORG_COOKIE } from "@/lib/api";

const INSTALLATION_ORG_COOKIE = "ai_sdlc_github_installation_org";
const CALLBACK_PATH = "/api/github/installations/callback";

function appOrigin(request: NextRequest): string {
  const configuredUrl = process.env["APP_URL"];
  return configuredUrl ? new URL(configuredUrl).origin : request.nextUrl.origin;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const origin = appOrigin(request);
  const slug = process.env["NEXT_PUBLIC_GITHUB_APP_SLUG"];
  if (!slug) {
    return NextResponse.redirect(
      new URL("/dashboard/repositories?installError=app_not_configured", origin),
    );
  }

  const organizationId =
    request.nextUrl.searchParams.get("organizationId") ??
    request.cookies.get(SELECTED_ORG_COOKIE)?.value;
  if (!organizationId) {
    return NextResponse.redirect(
      new URL("/dashboard/repositories?installError=missing_organization", origin),
    );
  }

  const apiBaseUrl = process.env["API_INTERNAL_URL"];
  if (!apiBaseUrl) {
    throw new Error("API_INTERNAL_URL is required to start a GitHub installation");
  }

  const accessResponse = await fetch(
    new URL(`/api/organizations/${encodeURIComponent(organizationId)}/installations`, apiBaseUrl),
    {
      headers: { Cookie: request.headers.get("cookie") ?? "" },
      cache: "no-store",
    },
  );
  if (!accessResponse.ok) {
    if (accessResponse.status === 401 || accessResponse.status === 403) {
      const error = accessResponse.status === 401 ? "sign_in_required" : "forbidden";
      return NextResponse.redirect(
        new URL(`/dashboard/repositories?installError=${error}`, origin),
      );
    }
    throw new Error(
      `Could not validate GitHub installation access (API returned ${accessResponse.status})`,
    );
  }

  const installUrl = new URL(
    `https://github.com/apps/${encodeURIComponent(slug)}/installations/new`,
  );
  installUrl.searchParams.set("state", organizationId);
  const response = NextResponse.redirect(installUrl);
  response.cookies.set(INSTALLATION_ORG_COOKIE, organizationId, {
    httpOnly: true,
    secure: origin.startsWith("https://"),
    sameSite: "lax",
    path: CALLBACK_PATH,
    maxAge: 10 * 60,
  });
  return response;
}
