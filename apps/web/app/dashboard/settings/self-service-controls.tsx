"use client";

import { useState } from "react";

interface InstallationDisconnectButtonProps {
  organizationId: string;
  installationId: string;
}

export function InstallationDisconnectButton({
  organizationId,
  installationId,
}: InstallationDisconnectButtonProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function disconnect() {
    if (
      !window.confirm(
        "Disconnect this GitHub installation in Nomalog? Monitoring and queued assessments for its repositories will stop. You must also remove the GitHub App from GitHub to revoke its authorization.",
      )
    ) {
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/backend/api/organizations/${encodeURIComponent(organizationId)}/installations/${encodeURIComponent(installationId)}`,
        { method: "DELETE" },
      );
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error("Nomalog could not disconnect the GitHub installation.");
      if (
        typeof payload !== "object" ||
        payload === null ||
        !("data" in payload) ||
        typeof payload.data !== "object" ||
        payload.data === null ||
        !("disconnected" in payload.data) ||
        payload.data.disconnected !== true
      ) {
        throw new Error("Nomalog returned an unexpected disconnect response.");
      }
      setMessage("Disconnected in Nomalog. Remove the app in GitHub to revoke its authorization.");
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not disconnect the installation.");
      setPending(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        className="rounded border border-red-300 px-3 py-1 text-xs font-semibold text-red-800 disabled:opacity-50"
        disabled={pending}
        onClick={() => {
          void disconnect();
        }}
      >
        {pending ? "Disconnecting…" : "Disconnect"}
      </button>
      {message && (
        <p role="status" className="mt-1 max-w-xs text-xs text-slate-600">
          {message}
        </p>
      )}
    </div>
  );
}

interface DataDeletionRequestProps {
  organizationId: string;
  organizationSlug: string;
  isOwner: boolean;
  currentStatus: string | null;
}

export function DataDeletionRequest({
  organizationId,
  organizationSlug,
  isOwner,
  currentStatus,
}: DataDeletionRequestProps) {
  const [confirmation, setConfirmation] = useState("");
  const [status, setStatus] = useState(currentStatus);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function requestDeletion() {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/backend/api/organizations/${encodeURIComponent(organizationId)}/settings/data-deletion`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ confirmOrganizationSlug: confirmation }),
        },
      );
      const payload: unknown = await response.json();
      if (!response.ok) {
        const error =
          typeof payload === "object" && payload !== null && "error" in payload
            ? payload.error
            : null;
        throw new Error(
          typeof error === "object" && error !== null && "message" in error
            ? String(error.message)
            : "Could not submit the deletion request.",
        );
      }
      if (
        typeof payload !== "object" ||
        payload === null ||
        !("data" in payload) ||
        typeof payload.data !== "object" ||
        payload.data === null ||
        !("status" in payload.data) ||
        typeof payload.data.status !== "string"
      ) {
        throw new Error("Nomalog returned an unexpected deletion-request response.");
      }
      setStatus(payload.data.status);
      setConfirmation("");
      setMessage(
        "Request submitted. An operator must verify and process it; data is not deleted immediately.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not submit the deletion request.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="space-y-3">
      <p className="text-sm text-slate-600">
        A deletion request is reviewed by an operator and does not immediately erase organization
        data. Active subscriptions must be resolved before the request can be fulfilled. Current
        request status: <strong>{status ?? "None"}</strong>.
      </p>
      {isOwner && !status && (
        <>
          <label className="block text-sm text-slate-700" htmlFor="deletion-confirmation">
            Enter <code>{organizationSlug}</code> to confirm an organization data-deletion request.
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="deletion-confirmation"
              value={confirmation}
              onChange={(event) => {
                setConfirmation(event.target.value);
              }}
              className="rounded border border-slate-300 px-3 py-2 text-sm"
              autoComplete="off"
            />
            <button
              type="button"
              className="rounded bg-red-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              disabled={pending || confirmation !== organizationSlug}
              onClick={() => {
                void requestDeletion();
              }}
            >
              {pending ? "Submitting…" : "Request deletion"}
            </button>
          </div>
        </>
      )}
      {!isOwner && (
        <p className="text-xs text-slate-500">Only the organization owner can request deletion.</p>
      )}
      {message && (
        <p role="status" className="text-sm text-slate-700">
          {message}
        </p>
      )}
    </section>
  );
}
