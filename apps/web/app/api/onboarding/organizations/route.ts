import { NextRequest, NextResponse } from "next/server";
import { SELECTED_ORG_COOKIE } from "@/lib/api";
import type { ApiEnvelope } from "@/lib/api";

interface CreatedOrganization {
  id: string;
}

function onboardingRedirect(request: NextRequest, error?: "invalid_name" | "create_failed") {
  const url = new URL("/onboarding", getAppOrigin(request));
  if (error) {
    url.searchParams.set("error", error);
  }
  return NextResponse.redirect(url, 303);
}

function getAppOrigin(request: NextRequest): string {
  const configuredUrl = process.env["APP_URL"];
  return configuredUrl ? new URL(configuredUrl).origin : request.nextUrl.origin;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get("origin");
  if (origin && origin !== getAppOrigin(request)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const form = await request.formData();
  const name = form.get("name");
  if (typeof name !== "string" || !name.trim()) {
    return onboardingRedirect(request, "invalid_name");
  }

  const apiBaseUrl = process.env["API_INTERNAL_URL"];
  if (!apiBaseUrl) {
    throw new Error("API_INTERNAL_URL is required for organization onboarding");
  }

  const response = await fetch(new URL("/api/organizations", apiBaseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: request.headers.get("cookie") ?? "",
    },
    body: JSON.stringify({ name: name.trim() }),
    cache: "no-store",
  });

  const result = (await response.json()) as ApiEnvelope<CreatedOrganization>;
  if (!response.ok || !result.data?.id) {
    return onboardingRedirect(request, "create_failed");
  }

  const redirect = NextResponse.redirect(new URL("/dashboard", getAppOrigin(request)), 303);
  redirect.cookies.set(SELECTED_ORG_COOKIE, result.data.id, {
    httpOnly: true,
    secure: getAppOrigin(request).startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return redirect;
}
