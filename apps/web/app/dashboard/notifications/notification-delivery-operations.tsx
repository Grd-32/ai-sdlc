"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { NotificationDeliveryOperations } from "@/lib/api";

export function NotificationDeliveryOperationsPanel({
  organizationId,
  deliveryOperations,
}: {
  organizationId: string;
  deliveryOperations: NotificationDeliveryOperations;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const base = `/api/backend/api/organizations/${encodeURIComponent(organizationId)}/notification-delivery-operations`;

  async function retry(notificationId: string) {
    setBusyId(notificationId);
    setError("");
    try {
      const response = await fetch(`${base}/${encodeURIComponent(notificationId)}/retry`, {
        method: "POST",
      });
      const result = (await response.json()) as {
        error: { message: string } | null;
      };
      if (!response.ok) {
        setError(result.error?.message ?? "The notification retry could not be queued.");
        return;
      }
      router.refresh();
    } catch (cause) {
      console.error("[notifications] delivery retry failed", cause);
      setError("The server could not be reached. Retry was not confirmed.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="font-semibold text-slate-900">Email delivery operations</h2>
      <p className="mt-1 text-sm text-slate-600">
        Last 7 days · counts mean queued or provider-accepted, not confirmed delivered.
      </p>
      {error && (
        <p
          role="alert"
          className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-3 text-sm">
        {Object.entries(deliveryOperations.statusCounts).map(([status, count]) => (
          <span key={status} className="rounded border border-slate-200 px-3 py-2">
            {status}: {count}
          </span>
        ))}
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b text-slate-500">
            <tr>
              <th className="py-2 pr-3">Attempt</th>
              <th className="py-2 pr-3">Event</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3">Latency</th>
              <th className="py-2 pr-3">Provider error</th>
              <th className="py-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {deliveryOperations.attempts.map((attempt) => (
              <tr key={attempt.id} className="border-b border-slate-100">
                <td className="py-2 pr-3">
                  {attempt.attempt} · {new Date(attempt.attemptedAt).toLocaleString()}
                </td>
                <td className="py-2 pr-3">{attempt.notification.type}</td>
                <td className="py-2 pr-3">{attempt.status}</td>
                <td className="py-2 pr-3">
                  {attempt.latencyMs === null ? "—" : `${attempt.latencyMs} ms`}
                </td>
                <td className="py-2 pr-3">{attempt.errorCode ?? "—"}</td>
                <td className="py-2">
                  {attempt.status === "FAILED" && (
                    <button
                      type="button"
                      disabled={Boolean(busyId)}
                      onClick={() => void retry(attempt.notification.id)}
                      className="font-medium text-orange-800 hover:underline disabled:opacity-50"
                    >
                      {busyId === attempt.notification.id ? "Queueing…" : "Retry"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {deliveryOperations.attempts.length === 0 && (
              <tr>
                <td colSpan={6} className="py-3 text-slate-500">
                  No delivery attempts in this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
