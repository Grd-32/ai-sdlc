"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { NotificationPage, NotificationPreferences } from "@/lib/api";

interface ApiResponse {
  data: unknown;
  error: { message: string } | null;
}

export function NotificationCenter({
  organizationId,
  initialPage,
  initialPreferences,
}: {
  organizationId: string;
  initialPage: NotificationPage;
  initialPreferences: NotificationPreferences;
}) {
  const router = useRouter();
  const [notifications, setNotifications] = useState(initialPage.items);
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor);
  const [unreadCount, setUnreadCount] = useState(initialPage.unreadCount);
  const [preferences, setPreferences] = useState(initialPreferences);
  const [busy, setBusy] = useState(false);
  const [loadingPage, setLoadingPage] = useState(false);
  const [category, setCategory] = useState("ALL");
  const [severity, setSeverity] = useState("ALL");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [error, setError] = useState("");
  const base = `/api/backend/api/organizations/${encodeURIComponent(organizationId)}`;

  useEffect(() => {
    setNotifications(initialPage.items);
    setNextCursor(initialPage.nextCursor);
    setUnreadCount(initialPage.unreadCount);
  }, [initialPage]);

  async function request(path: string, method: "POST" | "PATCH", body?: unknown) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const result = (await response.json()) as ApiResponse;
      if (!response.ok) {
        setError(result.error?.message ?? "The notification action could not be completed.");
        return false;
      }
      if (path === "/notifications/read-all") {
        const readAt = new Date().toISOString();
        setNotifications((items) => (unreadOnly ? [] : items.map((item) => ({ ...item, readAt }))));
        setUnreadCount(0);
      } else {
        const match = /^\/notifications\/([^/]+)\/read$/.exec(path);
        if (match) {
          const notificationId = decodeURIComponent(match[1] ?? "");
          setNotifications((items) =>
            unreadOnly
              ? items.filter((item) => item.id !== notificationId)
              : items.map((item) =>
                  item.id === notificationId ? { ...item, readAt: new Date().toISOString() } : item,
                ),
          );
          setUnreadCount((count) => Math.max(0, count - 1));
        }
      }
      router.refresh();
      return true;
    } catch (cause) {
      console.error("[notifications] request failed", cause);
      setError("The server could not be reached. Your change was not confirmed.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveEmailPreference(field: keyof NotificationPreferences, enabled: boolean) {
    const saved = await request("/notification-preferences", "PATCH", { [field]: enabled });
    if (saved) setPreferences((current) => ({ ...current, [field]: enabled }));
  }

  async function loadPage(reset: boolean) {
    setLoadingPage(true);
    setError("");
    try {
      const params = new URLSearchParams({
        limit: "50",
        category,
        severity,
        unreadOnly: String(unreadOnly),
      });
      if (!reset && nextCursor) params.set("cursor", nextCursor);
      const response = await fetch(`${base}/notifications?${params.toString()}`, {
        cache: "no-store",
      });
      const result = (await response.json()) as {
        data: NotificationPage | null;
        error: { message: string } | null;
      };
      const page = result.data;
      if (!response.ok || !page) {
        setError(result.error?.message ?? "Notifications could not be loaded.");
        return;
      }
      setNotifications((items) => (reset ? page.items : [...items, ...page.items]));
      setNextCursor(page.nextCursor);
      setUnreadCount(page.unreadCount);
    } catch (cause) {
      console.error("[notifications] inbox request failed", cause);
      setError("The server could not be reached. Notifications were not refreshed.");
    } finally {
      setLoadingPage(false);
    }
  }

  return (
    <div className="space-y-5">
      {error && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white p-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Email notifications</h2>
          <p className="mt-1 text-sm text-slate-600">
            In-app notifications remain available when email is disabled or not configured.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
          <input
            type="checkbox"
            checked={preferences.emailEnabled}
            disabled={busy}
            onChange={(event) => void saveEmailPreference("emailEnabled", event.target.checked)}
            className="h-4 w-4 rounded border-slate-300 accent-orange-700"
          />
          Enable email notifications
        </label>
        <div className="grid w-full gap-2 border-t border-slate-100 pt-3 sm:grid-cols-2">
          {(
            [
              ["securityEmailEnabled", "Security"],
              ["assessmentsEmailEnabled", "Assessments"],
              ["governanceEmailEnabled", "Governance and reviews"],
              ["integrationsEmailEnabled", "Integrations"],
              ["accountEmailEnabled", "Account and billing"],
            ] as const
          ).map(([field, label]) => (
            <label key={field} className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={preferences[field]}
                disabled={busy || !preferences.emailEnabled}
                onChange={(event) => void saveEmailPreference(field, event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 accent-orange-700"
              />
              {label}
            </label>
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="font-semibold text-slate-900">Inbox</h2>
          <span className="text-xs text-slate-500">{unreadCount} unread</span>
          {unreadCount > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void request("/notifications/read-all", "POST")}
              className="text-sm font-medium text-orange-800 hover:underline disabled:opacity-50"
            >
              Mark all read
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
          <label className="text-xs font-medium text-slate-600">
            Category
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="mt-1 block h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"
            >
              {["ALL", "SECURITY", "ASSESSMENTS", "GOVERNANCE", "INTEGRATIONS", "ACCOUNT"].map(
                (value) => (
                  <option key={value} value={value}>
                    {value === "ALL" ? "All categories" : value.toLowerCase()}
                  </option>
                ),
              )}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">
            Severity
            <select
              value={severity}
              onChange={(event) => setSeverity(event.target.value)}
              className="mt-1 block h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"
            >
              {["ALL", "CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"].map((value) => (
                <option key={value} value={value}>
                  {value === "ALL" ? "All severities" : value}
                </option>
              ))}
            </select>
          </label>
          <label className="flex h-9 items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(event) => setUnreadOnly(event.target.checked)}
            />
            Unread only
          </label>
          <button
            type="button"
            disabled={loadingPage}
            onClick={() => void loadPage(true)}
            className="h-9 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 disabled:opacity-50"
          >
            Apply filters
          </button>
        </div>
        {notifications.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">You’re all caught up.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {notifications.map((notification) => (
              <li
                key={notification.id}
                className={`flex flex-wrap items-start justify-between gap-4 px-4 py-4 ${
                  notification.readAt ? "" : "bg-orange-50/40"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {notification.href ? (
                      <Link
                        href={notification.href}
                        className={`text-sm hover:underline ${
                          notification.readAt
                            ? "font-medium text-slate-800"
                            : "font-semibold text-slate-950"
                        }`}
                      >
                        {notification.title}
                      </Link>
                    ) : (
                      <span className="text-sm font-semibold text-slate-950">
                        {notification.title}
                      </span>
                    )}
                    {!notification.readAt && (
                      <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-orange-900">
                        New
                      </span>
                    )}
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase text-slate-600">
                      {notification.category}
                    </span>
                    {notification.severity && (
                      <span className="rounded bg-amber-50 px-2 py-0.5 text-[10px] font-medium uppercase text-amber-800">
                        {notification.severity}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{notification.body}</p>
                  <p className="mt-2 text-xs text-slate-500">
                    {new Date(notification.createdAt).toLocaleString()} ·{" "}
                    {notification.emailStatus === "SENT"
                      ? "Accepted by email provider"
                      : notification.emailStatus === "FAILED"
                        ? "Email delivery failed"
                        : notification.emailStatus === "PENDING"
                          ? "Email pending"
                          : "In-app only"}
                  </p>
                </div>
                {!notification.readAt && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void request(`/notifications/${notification.id}/read`, "POST")}
                    className="text-xs font-medium text-slate-600 hover:text-slate-950 disabled:opacity-50"
                  >
                    Mark read
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {nextCursor && (
          <div className="border-t border-slate-100 p-4 text-center">
            <button
              type="button"
              disabled={loadingPage}
              onClick={() => void loadPage(false)}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
            >
              {loadingPage ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
