import type { Hono } from "hono";
import { prisma, recordAuditEvent } from "@ai-sdlc/db";
import { isEligibleForApprovalRequirement, resolveReviewAction } from "@ai-sdlc/policy";
import { publishCheckRun } from "@ai-sdlc/github";
import { requireAuth, requireOrganizationRole } from "../middleware/auth.js";
import { createUserNotification } from "../notifications.js";
import type { AppEnv } from "../types.js";
import { readJsonObject } from "../request-body.js";

const REVIEW_DECISIONS = new Set(["APPROVED", "REJECTED", "CHANGES_REQUESTED"]);

function isAuthor(reviewerUsername: string | null, authorLogin: string | null): boolean {
  return Boolean(
    reviewerUsername &&
    authorLogin &&
    reviewerUsername.localeCompare(authorLogin, undefined, { sensitivity: "accent" }) === 0,
  );
}

async function syncReviewCheck(organizationId: string, pullRequestId: string) {
  const pullRequest = await prisma.pullRequest.findFirst({
    where: { id: pullRequestId, organizationId },
    include: {
      repository: {
        include: {
          installation: {
            select: { githubInstallationId: true, active: true },
          },
        },
      },
      aiActivities: { orderBy: { createdAt: "desc" }, take: 1 },
      riskAssessments: { orderBy: { createdAt: "desc" }, take: 1 },
      policyDecisions: { orderBy: { createdAt: "desc" }, take: 1 },
      codeChanges: { select: { sensitiveAreas: true } },
      reviews: {
        where: { status: "COMPLETED" },
        select: {
          reviewerId: true,
          reviewerRole: true,
          decision: true,
          status: true,
          reviewedHeadSha: true,
        },
      },
    },
  });

  if (!pullRequest) {
    throw new Error("Pull request not found");
  }
  if (!pullRequest.headSha) {
    throw new Error("Pull request has no current head commit");
  }

  const policy = pullRequest.policyDecisions[0];
  if (!policy || policy.action !== "REVIEW") {
    throw new Error("The current policy decision does not require human review");
  }

  const currentHeadReviews = pullRequest.reviews.filter(
    (review) => review.reviewedHeadSha === pullRequest.headSha,
  );
  const outcome = resolveReviewAction(
    policy.requiredApprovals,
    currentHeadReviews.flatMap((review) => {
      const role = review.reviewerRole;
      if (!role || !review.reviewerId || !review.decision) {
        return [];
      }
      return [
        {
          reviewerId: review.reviewerId,
          role,
          decision: review.decision,
          status: review.status,
        },
      ];
    }),
  );
  const policyAction = outcome ?? "REVIEW";
  const installation = pullRequest.repository.installation;
  if (!installation?.active) {
    throw new Error("No active GitHub App installation is connected to this repository");
  }

  const ai = pullRequest.aiActivities[0];
  const risk = pullRequest.riskAssessments[0];
  const published = await publishCheckRun({
    githubInstallationId: installation.githubInstallationId,
    owner: pullRequest.repository.owner,
    repo: pullRequest.repository.name,
    headSha: pullRequest.headSha,
    existingCheckRunId: pullRequest.githubCheckRunId,
    summaryInput: {
      aiInvolvement: ai?.involvement ?? "UNKNOWN",
      ...(ai?.agent && ai.agent !== "unknown" ? { aiAgent: ai.agent } : {}),
      aiConfidence: ai?.confidence ?? 0,
      riskScore: risk?.score ?? 0,
      riskLevel: risk?.level ?? "LOW",
      sensitiveAreas: [
        ...new Set(pullRequest.codeChanges.flatMap((change) => change.sensitiveAreas)),
      ],
      policyAction,
      policyReasons: [
        ...(policy.explanation ? [policy.explanation] : []),
        ...(policyAction === "REVIEW"
          ? ["Waiting for all distinct, eligible reviewer approvals."]
          : policyAction === "BLOCK"
            ? ["A reviewer rejected this change."]
            : ["All required human approvals have been recorded for this commit."]),
      ],
      requiredApprovals: policy.requiredApprovals,
      ...(process.env["APP_URL"]
        ? { passportUrl: `${process.env["APP_URL"]}/dashboard/changes/${pullRequest.id}` }
        : {}),
    },
  });

  await prisma.pullRequest.update({
    where: { id: pullRequest.id },
    data: { githubCheckRunId: published.checkRunId },
  });

  return { action: policyAction, conclusion: published.conclusion };
}

export function registerReviewRoutes(app: Hono<AppEnv>): void {
  app.post(
    "/api/organizations/:organizationId/pull-requests/:pullRequestId/reviews",
    requireAuth,
    requireOrganizationRole("ENGINEER"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const userId = c.get("userId");
      if (!organizationId || !userId) {
        return c.json(
          {
            data: null,
            error: { code: "UNAUTHENTICATED", message: "Organization access is required" },
          },
          401,
        );
      }
      const pullRequestId = c.req.param("pullRequestId");
      if (!pullRequestId) {
        return c.json(
          { data: null, error: { code: "VALIDATION_ERROR", message: "pullRequestId is required" } },
          400,
        );
      }
      const body = await readJsonObject(c);
      const reviewerId = typeof body?.reviewerId === "string" ? body.reviewerId : "";
      const requirement =
        typeof body?.requirement === "string" ? body.requirement.trim().toUpperCase() : "";

      if (!reviewerId) {
        return c.json(
          { data: null, error: { code: "VALIDATION_ERROR", message: "reviewerId is required" } },
          400,
        );
      }

      const pullRequest = await prisma.pullRequest.findFirst({
        where: { id: pullRequestId, organizationId },
        include: {
          policyDecisions: { orderBy: { createdAt: "desc" }, take: 1 },
          repository: { select: { owner: true, name: true } },
        },
      });
      if (!pullRequest) {
        return c.json(
          { data: null, error: { code: "NOT_FOUND", message: "Pull request not found" } },
          404,
        );
      }
      const headSha = pullRequest.headSha;
      if (!headSha) {
        return c.json(
          {
            data: null,
            error: { code: "INVALID_STATE", message: "Pull request has no head commit" },
          },
          409,
        );
      }

      const policy = pullRequest.policyDecisions[0];
      if (!policy || policy.action !== "REVIEW") {
        return c.json(
          {
            data: null,
            error: { code: "INVALID_STATE", message: "This pull request does not require review" },
          },
          409,
        );
      }

      const reviewer = await prisma.organizationMember.findFirst({
        where: {
          organizationId,
          userId: reviewerId,
          scimActive: true,
          user: { active: true },
        },
        include: {
          user: { select: { id: true, username: true, name: true, email: true } },
        },
      });
      if (!reviewer) {
        return c.json(
          {
            data: null,
            error: { code: "NOT_FOUND", message: "Active organization member not found" },
          },
          404,
        );
      }
      if (isAuthor(reviewer.user.username, pullRequest.authorLogin)) {
        return c.json(
          {
            data: null,
            error: {
              code: "FORBIDDEN",
              message: "Pull-request authors cannot approve their own change",
            },
          },
          403,
        );
      }
      if (!isEligibleForApprovalRequirement(reviewer.role, policy.requiredApprovals, requirement)) {
        return c.json(
          {
            data: null,
            error: {
              code: "INELIGIBLE_REVIEWER",
              message:
                "The selected reviewer does not meet this approval requirement, or the policy uses an unsupported requirement label.",
            },
          },
          400,
        );
      }

      const existing = await prisma.review.findUnique({
        where: {
          pullRequestId_reviewerId_reviewedHeadSha_requirement: {
            pullRequestId,
            reviewerId,
            reviewedHeadSha: headSha,
            requirement,
          },
        },
      });
      if (existing?.status === "COMPLETED") {
        return c.json(
          {
            data: null,
            error: {
              code: "REVIEW_ALREADY_SUBMITTED",
              message: "This reviewer has already completed this review",
            },
          },
          409,
        );
      }

      const review = await prisma.review.upsert({
        where: {
          pullRequestId_reviewerId_reviewedHeadSha_requirement: {
            pullRequestId,
            reviewerId,
            reviewedHeadSha: headSha,
            requirement,
          },
        },
        create: {
          organizationId,
          pullRequestId,
          reviewerId,
          reviewedHeadSha: headSha,
          requirement,
          status: "PENDING",
        },
        update: {},
      });

      await recordAuditEvent({
        organizationId,
        actorId: userId,
        eventType: "REVIEW_ASSIGNED",
        metadata: { pullRequestId, reviewId: review.id, reviewerId, requirement, headSha },
      });

      let notificationEmailStatus: string | null = null;
      try {
        const notification = await createUserNotification({
          organizationId,
          userId: reviewerId,
          type: "REVIEW_ASSIGNED",
          title: "Review requested",
          body: `${pullRequest.repository.owner}/${pullRequest.repository.name} #${pullRequest.number}: ${pullRequest.title}`,
          href: `/dashboard/changes/${pullRequestId}`,
          dedupeKey: `review:${review.id}:assigned`,
        });
        notificationEmailStatus = notification.emailStatus;
      } catch (cause) {
        console.error("[reviews] assignment notification could not be persisted", cause);
      }

      return c.json({ data: { ...review, notificationEmailStatus }, error: null }, 201);
    },
  );

  app.post(
    "/api/organizations/:organizationId/pull-requests/:pullRequestId/reviews/:reviewId/decision",
    requireAuth,
    requireOrganizationRole("REVIEWER"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const userId = c.get("userId");
      if (!organizationId || !userId) {
        return c.json(
          {
            data: null,
            error: { code: "UNAUTHENTICATED", message: "Organization access is required" },
          },
          401,
        );
      }
      const pullRequestId = c.req.param("pullRequestId");
      const reviewId = c.req.param("reviewId");
      if (!pullRequestId || !reviewId) {
        return c.json(
          {
            data: null,
            error: { code: "VALIDATION_ERROR", message: "pullRequestId and reviewId are required" },
          },
          400,
        );
      }
      const body = await readJsonObject(c);
      const decision = typeof body?.decision === "string" ? body.decision : "";
      const comment =
        typeof body?.comment === "string" ? body.comment.trim().slice(0, 4000) || null : null;

      if (!REVIEW_DECISIONS.has(decision)) {
        return c.json(
          {
            data: null,
            error: {
              code: "VALIDATION_ERROR",
              message: "decision must be APPROVED, REJECTED, or CHANGES_REQUESTED",
            },
          },
          400,
        );
      }

      const pullRequest = await prisma.pullRequest.findFirst({
        where: { id: pullRequestId, organizationId },
        select: { id: true, headSha: true, authorLogin: true },
      });
      if (!pullRequest) {
        return c.json(
          { data: null, error: { code: "NOT_FOUND", message: "Pull request not found" } },
          404,
        );
      }
      const headSha = pullRequest.headSha;
      if (!headSha) {
        return c.json(
          {
            data: null,
            error: { code: "INVALID_STATE", message: "Pull request has no head commit" },
          },
          409,
        );
      }

      const assignedReview = await prisma.review.findFirst({
        where: {
          id: reviewId,
          organizationId,
          pullRequestId,
          reviewerId: userId,
          status: "PENDING",
          reviewedHeadSha: headSha,
        },
        include: {
          reviewer: {
            select: {
              username: true,
              memberships: {
                where: { organizationId, scimActive: true },
                select: { role: true },
                take: 1,
              },
            },
          },
        },
      });
      if (!assignedReview?.reviewer?.memberships[0]) {
        return c.json(
          {
            data: null,
            error: {
              code: "REVIEW_NOT_ASSIGNED",
              message:
                "No pending review assigned to you exists for the current pull-request commit",
            },
          },
          404,
        );
      }
      if (isAuthor(assignedReview.reviewer.username, pullRequest.authorLogin)) {
        return c.json(
          {
            data: null,
            error: {
              code: "FORBIDDEN",
              message: "Pull-request authors cannot approve their own change",
            },
          },
          403,
        );
      }
      const currentPolicy = await prisma.policyDecision.findFirst({
        where: { organizationId, pullRequestId },
        orderBy: { createdAt: "desc" },
        select: { requiredApprovals: true, action: true },
      });
      if (
        !currentPolicy ||
        currentPolicy.action !== "REVIEW" ||
        !isEligibleForApprovalRequirement(
          assignedReview.reviewer.memberships[0].role,
          currentPolicy.requiredApprovals,
          assignedReview.requirement,
        )
      ) {
        return c.json(
          {
            data: null,
            error: {
              code: "INELIGIBLE_REVIEWER",
              message: "Your current organization role no longer meets this review requirement",
            },
          },
          403,
        );
      }

      const updated = await prisma.review.updateMany({
        where: {
          id: reviewId,
          organizationId,
          reviewerId: userId,
          status: "PENDING",
          reviewedHeadSha: headSha,
        },
        data: {
          decision: decision as "APPROVED" | "REJECTED" | "CHANGES_REQUESTED",
          status: "COMPLETED",
          comment,
          reviewerRole: assignedReview.reviewer.memberships[0].role,
          completedAt: new Date(),
        },
      });
      if (updated.count !== 1) {
        return c.json(
          {
            data: null,
            error: {
              code: "REVIEW_ALREADY_SUBMITTED",
              message: "This review was already submitted or the pull-request commit changed",
            },
          },
          409,
        );
      }

      await recordAuditEvent({
        organizationId,
        actorId: userId,
        eventType: "REVIEW_DECISION_RECORDED",
        metadata: { pullRequestId, reviewId, decision, headSha },
      });

      const review = await prisma.review.findUniqueOrThrow({ where: { id: reviewId } });
      try {
        const check = await syncReviewCheck(organizationId, pullRequestId);
        return c.json({ data: { review, check }, error: null });
      } catch (error) {
        console.error(
          "[review] decision was saved but GitHub check synchronization failed:",
          error,
        );
        return c.json(
          {
            data: { review, check: null },
            error: {
              code: "REVIEW_RECORDED_CHECK_UPDATE_FAILED",
              message:
                "Your review was saved, but the GitHub check could not be updated. Retry check synchronization.",
            },
          },
          502,
        );
      }
    },
  );

  app.post(
    "/api/organizations/:organizationId/pull-requests/:pullRequestId/reviews/sync-check",
    requireAuth,
    requireOrganizationRole("ENGINEER"),
    async (c) => {
      const organizationId = c.get("organizationId");
      if (!organizationId) {
        return c.json(
          { data: null, error: { code: "FORBIDDEN", message: "Organization context is required" } },
          403,
        );
      }
      const pullRequestId = c.req.param("pullRequestId");
      if (!pullRequestId) {
        return c.json(
          { data: null, error: { code: "VALIDATION_ERROR", message: "pullRequestId is required" } },
          400,
        );
      }
      try {
        const result = await syncReviewCheck(organizationId, pullRequestId);
        return c.json({ data: result, error: null });
      } catch (error) {
        console.error("[review] GitHub check synchronization failed:", error);
        return c.json(
          {
            data: null,
            error: {
              code: "REVIEW_CHECK_SYNC_FAILED",
              message:
                error instanceof Error ? error.message : "Failed to synchronize GitHub check",
            },
          },
          502,
        );
      }
    },
  );
}
