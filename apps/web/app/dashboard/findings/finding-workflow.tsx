"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { OrganizationMemberSummary, SecurityFindingWorkflowRecord } from "@/lib/api";

const STATUSES = ["OPEN", "TRIAGED", "IN_PROGRESS", "RESOLVED", "ACCEPTED", "FALSE_POSITIVE"];

interface ApiResponse {
  data: unknown;
  error: { message: string } | null;
}

function statusLabel(status: string): string {
  return status
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

function dueDateValue(value: string | null): string {
  return value ? value.slice(0, 10) : "";
}

export function FindingWorkflow({
  organizationId,
  findings,
  members,
  canManage,
}: {
  organizationId: string;
  findings: SecurityFindingWorkflowRecord[];
  members: OrganizationMemberSummary[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const base = `/api/backend/api/organizations/${encodeURIComponent(organizationId)}/findings`;

  async function send(
    findingId: string,
    path: string,
    method: "PATCH" | "POST",
    body: unknown,
  ): Promise<boolean> {
    setBusyId(findingId);
    setError("");
    try {
      const response = await fetch(`${base}/${encodeURIComponent(findingId)}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as ApiResponse;
      if (!response.ok) {
        setError(result.error?.message ?? "The remediation update could not be saved.");
        return false;
      }
      router.refresh();
      return true;
    } catch (cause) {
      console.error("[findings] workflow request failed", cause);
      setError("The server could not be reached. The update was not confirmed.");
      return false;
    } finally {
      setBusyId("");
    }
  }

  if (findings.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">
        No security findings have been recorded for this organization.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {findings.map((finding) => (
        <FindingItem
          key={`${finding.id}-${finding.updatedAt}`}
          finding={finding}
          members={members}
          canManage={canManage}
          busy={busyId === finding.id}
          onSave={(body) => send(finding.id, "", "PATCH", body)}
          onComment={(comment) => send(finding.id, "/comments", "POST", { comment })}
        />
      ))}
    </div>
  );
}

function FindingItem({
  finding,
  members,
  canManage,
  busy,
  onSave,
  onComment,
}: {
  finding: SecurityFindingWorkflowRecord;
  members: OrganizationMemberSummary[];
  canManage: boolean;
  busy: boolean;
  onSave: (body: unknown) => Promise<boolean>;
  onComment: (comment: string) => Promise<boolean>;
}) {
  const [status, setStatus] = useState(finding.status);
  const [assigneeId, setAssigneeId] = useState(finding.assignee?.id ?? "");
  const [dueAt, setDueAt] = useState(dueDateValue(finding.dueAt));
  const [comment, setComment] = useState("");
  const [acceptanceExpiresAt, setAcceptanceExpiresAt] = useState(
    dueDateValue(finding.riskAcceptances[0]?.expiresAt ?? null),
  );
  const [activityComment, setActivityComment] = useState("");
  const closed = ["RESOLVED", "ACCEPTED", "FALSE_POSITIVE"].includes(finding.status);
  const overdue =
    !closed && finding.dueAt !== null && new Date(finding.dueAt).getTime() < Date.now();
  const acceptanceExpired =
    finding.status === "ACCEPTED" &&
    finding.riskAcceptances[0]?.expiresAt !== null &&
    finding.riskAcceptances[0]?.expiresAt !== undefined &&
    new Date(finding.riskAcceptances[0].expiresAt).getTime() < Date.now();

  async function save() {
    const body: Record<string, unknown> = {
      status,
      assigneeId: assigneeId || null,
      dueAt: dueAt ? new Date(`${dueAt}T00:00:00.000Z`).toISOString() : null,
    };
    if (comment.trim()) body["comment"] = comment.trim();
    if (status === "ACCEPTED" && acceptanceExpiresAt) {
      body["acceptanceExpiresAt"] = new Date(`${acceptanceExpiresAt}T00:00:00.000Z`).toISOString();
    }
    if (await onSave(body)) setComment("");
  }

  async function addComment() {
    if (await onComment(activityComment.trim())) setActivityComment("");
  }

  return (
    <article className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-800">
                {finding.severity}
              </span>
              <span className="text-xs text-slate-500">
                {finding.provider}
                {finding.category ? ` · ${finding.category}` : ""}
              </span>
              {finding.status === "RESOLVED" && (
                <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">
                  {finding.resolutionVerification === "VERIFIED"
                    ? "Verified remediation"
                    : finding.resolutionVerification === "USER_REPORTED"
                      ? "User-reported resolution"
                      : "Resolution not verified"}
                </span>
              )}
            </div>
            <h2 className="mt-2 font-semibold text-slate-950">{finding.title}</h2>
            {finding.description && (
              <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                {finding.description}
              </p>
            )}
            {(finding.repository || finding.file) && (
              <p className="mt-2 text-xs text-slate-500">
                {finding.repository
                  ? `${finding.repository.owner}/${finding.repository.name}`
                  : "Repository unavailable"}
                {finding.file ? ` · ${finding.file}${finding.line ? `:${finding.line}` : ""}` : ""}
                {finding.pullRequest && (
                  <>
                    {" · "}
                    <Link
                      href={`/dashboard/changes/${finding.pullRequest.id}`}
                      className="underline"
                    >
                      PR #{finding.pullRequest.number}
                    </Link>
                  </>
                )}
              </p>
            )}
          </div>
          {(overdue || acceptanceExpired) && (
            <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-800">
              {acceptanceExpired ? "Acceptance expired" : "Overdue"}
            </span>
          )}
        </div>

        {canManage && (
          <div className="grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-4">
            <label className="text-xs font-medium text-slate-600">
              Status
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                className="mt-1 block h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900"
              >
                {STATUSES.map((item) => (
                  <option key={item} value={item}>
                    {statusLabel(item)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600">
              Assignee
              <select
                value={assigneeId}
                onChange={(event) => setAssigneeId(event.target.value)}
                className="mt-1 block h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900"
              >
                <option value="">Unassigned</option>
                {members.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.name ?? member.username ?? member.email}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600">
              Due date
              <input
                type="date"
                value={dueAt}
                onChange={(event) => setDueAt(event.target.value)}
                className="mt-1 block h-10 w-full rounded-md border border-slate-300 px-2 text-sm text-slate-900"
              />
            </label>
            <div className="flex items-end">
              <button
                type="button"
                disabled={busy}
                onClick={() => void save()}
                className="h-10 w-full rounded-md bg-slate-900 px-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
              >
                Save workflow
              </button>
            </div>
            {status === "ACCEPTED" && (
              <div className="grid gap-3 sm:col-span-4 sm:grid-cols-2">
                <label className="text-xs font-medium text-slate-600">
                  Risk acceptance reason (required)
                  <input
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    maxLength={4000}
                    className="mt-1 block h-10 w-full rounded-md border border-slate-300 px-3 text-sm"
                    placeholder="Why is this finding being accepted?"
                  />
                </label>
                <label className="text-xs font-medium text-slate-600">
                  Acceptance expiry (required)
                  <input
                    type="date"
                    value={acceptanceExpiresAt}
                    onChange={(event) => setAcceptanceExpiresAt(event.target.value)}
                    className="mt-1 block h-10 w-full rounded-md border border-slate-300 px-3 text-sm"
                  />
                </label>
              </div>
            )}
            {status !== "ACCEPTED" && (
              <label className="text-xs font-medium text-slate-600 sm:col-span-4">
                Optional transition note
                <input
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  maxLength={4000}
                  className="mt-1 block h-10 w-full rounded-md border border-slate-300 px-3 text-sm"
                  placeholder="Add context to this status change"
                />
              </label>
            )}
          </div>
        )}

        <div className="border-t border-slate-100 pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Activity</h3>
          {finding.activities.length > 0 ? (
            <ul className="mt-2 space-y-2">
              {finding.activities.map((activity) => (
                <li key={activity.id} className="text-xs text-slate-600">
                  <span className="font-medium text-slate-800">
                    {activity.actor?.name ?? activity.actor?.username ?? "System"}
                  </span>
                  {" · "}
                  {activity.type === "STATUS_CHANGED"
                    ? `${statusLabel(activity.fromStatus ?? "")} → ${statusLabel(activity.toStatus ?? "")}`
                    : statusLabel(activity.type)}
                  {" · "}
                  {new Date(activity.createdAt).toLocaleString()}
                  {activity.comment && (
                    <p className="mt-1 whitespace-pre-wrap pl-2 text-slate-600">
                      {activity.comment}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-slate-500">No activity yet.</p>
          )}
          {canManage && (
            <div className="mt-3 flex flex-wrap gap-2">
              <label className="sr-only" htmlFor={`finding-comment-${finding.id}`}>
                Add finding comment
              </label>
              <input
                id={`finding-comment-${finding.id}`}
                value={activityComment}
                onChange={(event) => setActivityComment(event.target.value)}
                maxLength={4000}
                placeholder="Add a remediation note"
                className="h-9 min-w-0 flex-1 rounded-md border border-slate-300 px-3 text-sm"
              />
              <button
                type="button"
                disabled={busy || !activityComment.trim()}
                onClick={() => void addComment()}
                className="h-9 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 disabled:opacity-50"
              >
                Add note
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
