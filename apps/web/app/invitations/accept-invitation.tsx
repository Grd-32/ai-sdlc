"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

type ApiResult = {
  data?: { organizationId?: string; role?: string } | null;
  error?: { code?: string; message?: string } | null;
};

export function AcceptInvitation() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [message, setMessage] = useState("Checking your invitation…");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!token) {
      setMessage("This invitation link is missing its token.");
      setFailed(true);
      return;
    }

    let active = true;
    void fetch("/api/backend/api/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (response) => {
        if (response.status === 401) {
          const returnTo = `/invitations/accept?token=${encodeURIComponent(token)}`;
          window.location.assign(
            `/api/auth/github/login?redirectTo=${encodeURIComponent(returnTo)}`,
          );
          return;
        }
        const result = (await response.json()) as ApiResult;
        if (!response.ok || !result.data) {
          throw new Error(result.error?.message ?? "The invitation could not be accepted.");
        }
        if (active) {
          setMessage("Invitation accepted. Opening your organization…");
          window.location.assign("/dashboard/members");
        }
      })
      .catch((error: unknown) => {
        if (!active) return;
        setFailed(true);
        setMessage(
          error instanceof Error ? error.message : "The invitation could not be accepted.",
        );
      });

    return () => {
      active = false;
    };
  }, [token]);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-6">
      <section
        aria-live="polite"
        className="w-full rounded-xl border border-slate-200 bg-white p-8 shadow-sm"
      >
        <h1 className="text-2xl font-semibold text-slate-950">Accept organization invitation</h1>
        <p className={`mt-4 text-sm ${failed ? "text-red-700" : "text-slate-600"}`}>{message}</p>
        {failed && (
          <Link
            className="mt-6 inline-block font-medium text-blue-700 underline"
            href="/api/auth/github/login?redirectTo=%2Fdashboard"
          >
            Sign in with GitHub
          </Link>
        )}
      </section>
    </main>
  );
}
