"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  isEligibleForApprovalRequirement,
  type ReviewApprovalRequirement,
  type ReviewRole,
} from "@ai-sdlc/policy";
import type { OrganizationMemberSummary, ReviewRecord } from "@/lib/api";

const ROLE_PRIORITY: Record<string, number> = {
  OWNER: 9,
  ADMIN: 8,
  SECURITY: 7,
  SECURITY_ADMIN: 7,
  SECURITY_ANALYST: 6,
  ENGINEER: 5,
  SENIOR_ENGINEER: 5,
  PLATFORM_ENGINEER: 5,
  REVIEWER: 4,
  AUDITOR: 3,
  VIEWER: 2,
};
const ENGINEER_PRIORITY = 5;
const REVIEW_ROLES = new Set(Object.keys(ROLE_PRIORITY));

function isReviewRole(role: string): role is ReviewRole {
  return REVIEW_ROLES.has(role);
}

interface ApiResponse {
  data: unknown;
  error: { code: string; message: string } | null;
}

export function ReviewWorkflow({
  organizationId,
  pullRequestId,
  headSha,
  authorLogin,
  currentUserId,
  actorRole,
  requiredApprovals,
  requirements,
  reviews,
  members,
}: {
  organizationId: string;
  pullRequestId: string;
  headSha: string | null;
  authorLogin: string | null;
  currentUserId: string;
  actorRole: string;
  requiredApprovals: string[];
  requirements: ReviewApprovalRequirement[] | null;
  reviews: ReviewRecord[];
  members: OrganizationMemberSummary[];
}) {
  const router = useRouter();
  const [requirement, setRequirement] = useState(requirements?.[0]?.token ?? "");
  const [reviewerId, setReviewerId] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const route = `/api/backend/api/organizations/${encodeURIComponent(organizationId)}/pull-requests/${encodeURIComponent(pullRequestId)}/reviews`;
  const canManage = (ROLE_PRIORITY[actorRole] ?? 0) >= ENGINEER_PRIORITY;
  const currentReviews = reviews.filter((review) => review.reviewedHeadSha === headSha);
  const eligibleMembers = useMemo(
    () =>
      members.filter(
        (member) =>
          member.active &&
          !(
            member.username &&
            authorLogin &&
            member.username.toLowerCase() === authorLogin.toLowerCase()
          ) &&
          requirements !== null &&
          isReviewRole(member.role) &&
          isEligibleForApprovalRequirement(member.role, requiredApprovals, requirement),
      ),
    [authorLogin, members, requiredApprovals, requirement, requirements],
  );

  async function submit(url: string, body?: unknown, successMessage?: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const result = (await response.json()) as ApiResponse;
      if (!response.ok) {
        setError(result.error?.message ?? "The review action could not be completed.");
        if (result.data && result.error?.code === "REVIEW_RECORDED_CHECK_UPDATE_FAILED") {
          router.refresh();
        }
        return;
      }
      setNotice(successMessage ?? "Review workflow updated.");
      router.refresh();
    } catch (cause) {
      console.error("[reviews] review request failed:", cause);
      setError("The server could not be reached. The review action was not confirmed.");
    } finally {
      setBusy(false);
    }
  }

  const assignedToMe = currentReviews.filter(
    (review) =>
      review.reviewerId === currentUserId &&
      review.status === "PENDING" &&
      review.decision === null,
  );
  const assignedReviewerIds = new Set(
    currentReviews.map((review) => review.reviewerId).filter((id): id is string => id !== null),
  );
  const availableAssignees = eligibleMembers.filter(
    (member) => !assignedReviewerIds.has(member.userId),
  );

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-5 py-4">
        <h2 className="text-base font-semibold text-slate-900">Human review</h2>
        <p className="mt-1 text-sm text-slate-600">
          Reviews are attached to this exact commit. A new commit requires fresh approvals.
        </p>
      </div>
      <div className="space-y-5 p-5">
        {error && (
          <p
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {error}
          </p>
        )}
        {notice && (
          <p
            role="status"
            className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
          >
            {notice}
          </p>
        )}

        {!headSha ? (
          <p className="text-sm text-amber-800">
            This pull request has no recorded head commit, so reviews cannot be assigned or
            submitted.
          </p>
        ) : requirements === null ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            This policy contains an approval label that Nomalog cannot map to an organization role.
            Update the rule to use Reviewer, Engineer, Senior Engineer, Platform, or Security review
            before assigning approvals. Senior and platform review currently map to the Engineer
            role because no separate organization role exists.
          </div>
        ) : (
          <>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Required approval gates
              </h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {requirements.map((item) => (
                  <span
                    key={item.token}
                    className="rounded-full bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-900"
                  >
                    {item.label}
                  </span>
                ))}
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Each gate needs a different active member with the matching role. The pull-request
                author cannot review their own change.
              </p>
            </div>

            {canManage && (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-sm font-semibold text-slate-800">Assign a reviewer</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto]">
                  <label className="sr-only" htmlFor="review-requirement">
                    Approval requirement
                  </label>
                  <select
                    id="review-requirement"
                    value={requirement}
                    onChange={(event) => {
                      setRequirement(event.target.value);
                      setReviewerId("");
                    }}
                    className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"
                  >
                    {requirements.map((item) => (
                      <option key={item.token} value={item.token}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                  <label className="sr-only" htmlFor="review-assignee">
                    Reviewer
                  </label>
                  <select
                    id="review-assignee"
                    value={reviewerId}
                    onChange={(event) => setReviewerId(event.target.value)}
                    className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"
                  >
                    <option value="">Choose an eligible reviewer</option>
                    {availableAssignees.map((member) => (
                      <option key={member.userId} value={member.userId}>
                        {member.name ?? member.username ?? member.email} ·{" "}
                        {member.role.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={busy || !reviewerId}
                    onClick={() =>
                      void submit(
                        route,
                        { reviewerId, requirement },
                        "Reviewer assigned for the current commit.",
                      )
                    }
                    className="h-10 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Assign
                  </button>
                </div>
                {availableAssignees.length === 0 && (
                  <p className="mt-2 text-xs text-slate-500">
                    No active eligible members are available for this gate. Add or activate a member
                    with the required role on the Members page.
                  </p>
                )}
              </div>
            )}

            {currentReviews.length === 0 ? (
              <p className="rounded-md border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
                No reviewers have been assigned for this commit yet.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
                {currentReviews.map((review) => {
                  const isPending = review.status === "PENDING" && !review.decision;
                  const decisionLabel =
                    review.decision === "APPROVED"
                      ? "Approved"
                      : review.decision === "REJECTED"
                        ? "Rejected"
                        : review.decision === "CHANGES_REQUESTED"
                          ? "Changes requested"
                          : "Awaiting review";
                  return (
                    <li
                      key={review.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                    >
                      <div>
                        <p className="text-sm font-medium text-slate-800">
                          {review.reviewer?.name ??
                            (review.reviewer?.username
                              ? `@${review.reviewer.username}`
                              : "Organization member")}
                          {review.reviewerId === currentUserId && (
                            <span className="ml-2 text-xs font-normal text-slate-500">You</span>
                          )}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {review.requirement
                            ? (requirements.find((item) => item.token === review.requirement)
                                ?.label ?? review.requirement)
                            : "Reviewer approval"}{" "}
                          · {decisionLabel}
                        </p>
                        {review.comment && (
                          <p className="mt-1 max-w-2xl whitespace-pre-wrap text-xs text-slate-600">
                            {review.comment}
                          </p>
                        )}
                      </div>
                      {isPending && review.reviewerId === currentUserId && (
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="sr-only" htmlFor={`review-comment-${review.id}`}>
                            Review comment
                          </label>
                          <input
                            id={`review-comment-${review.id}`}
                            value={comment}
                            onChange={(event) => setComment(event.target.value)}
                            placeholder="Optional review note"
                            maxLength={4000}
                            className="h-9 w-48 rounded-md border border-slate-300 px-2 text-xs"
                          />
                          {(
                            [
                              ["APPROVED", "Approve"],
                              ["CHANGES_REQUESTED", "Request changes"],
                              ["REJECTED", "Reject"],
                            ] as const
                          ).map(([decision, label]) => (
                            <button
                              key={decision}
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void submit(
                                  `${route}/${encodeURIComponent(review.id)}/decision`,
                                  { decision, comment },
                                  `Your ${label.toLowerCase()} decision was recorded.`,
                                )
                              }
                              className={`rounded-md border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                                decision === "APPROVED"
                                  ? "border-emerald-300 text-emerald-800 hover:bg-emerald-50"
                                  : decision === "REJECTED"
                                    ? "border-red-300 text-red-800 hover:bg-red-50"
                                    : "border-amber-300 text-amber-800 hover:bg-amber-50"
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {assignedToMe.length === 0 &&
              currentReviews.some((review) => review.reviewerId === currentUserId) && (
                <p className="text-xs text-slate-500">
                  Your review for this commit has already been submitted.
                </p>
              )}
          </>
        )}

        {canManage && (
          <div className="flex justify-end border-t border-slate-100 pt-4">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void submit(`${route}/sync-check`, undefined, "The GitHub check was synchronized.")
              }
              className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {busy ? "Working…" : "Retry GitHub check sync"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
