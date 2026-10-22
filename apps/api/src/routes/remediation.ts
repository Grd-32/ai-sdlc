import type { Context, Hono } from "hono";
import { prisma, recordAuditEvent } from "@ai-sdlc/db";
import { requireAuth, requireOrganizationRole } from "../middleware/auth.js";
import { createUserNotification } from "../notifications.js";
import { readJsonObject } from "../request-body.js";
import type { AppEnv } from "../types.js";

const FINDING_STATUSES = new Set([
  "OPEN",
  "TRIAGED",
  "IN_PROGRESS",
  "RESOLVED",
  "ACCEPTED",
  "FALSE_POSITIVE",
]);

const ALLOWED_TRANSITIONS: Record<string, Set<string>> = {
  OPEN: new Set(["TRIAGED", "IN_PROGRESS", "RESOLVED", "ACCEPTED", "FALSE_POSITIVE"]),
  TRIAGED: new Set(["OPEN", "IN_PROGRESS", "RESOLVED", "ACCEPTED", "FALSE_POSITIVE"]),
  IN_PROGRESS: new Set(["OPEN", "TRIAGED", "RESOLVED", "ACCEPTED", "FALSE_POSITIVE"]),
  RESOLVED: new Set(["OPEN"]),
  ACCEPTED: new Set(["OPEN"]),
  FALSE_POSITIVE: new Set(["OPEN"]),
};

function error(c: Context<AppEnv>, code: string, message: string) {
  return c.json({ data: null, error: { code, message } }, 400);
}

export function registerRemediationRoutes(app: Hono<AppEnv>): void {
  app.post(
    "/api/organizations/:organizationId/findings/:findingId/verify-resolution",
    requireAuth,
    requireOrganizationRole("ENGINEER"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const userId = c.get("userId");
      const findingId = c.req.param("findingId");
      const finding = await prisma.securityFinding.findFirst({
        where: { id: findingId, organizationId },
        include: {
          repository: {
            select: {
              owner: true,
              name: true,
              provider: true,
              installation: { select: { githubInstallationId: true } },
            },
          },
        },
      });
      if (!finding) {
        return c.json(
          { data: null, error: { code: "NOT_FOUND", message: "Finding not found" } },
          404,
        );
      }
      if (finding.status === "ACCEPTED" || finding.status === "FALSE_POSITIVE") {
        return c.json(
          {
            data: null,
            error: {
              code: "FINDING_NOT_ELIGIBLE",
              message: "Accepted or false-positive findings cannot be provider-resolved.",
            },
          },
          409,
        );
      }
      const installationId = finding.repository?.installation?.githubInstallationId;
      const alertNumber = Number(finding.providerFindingId);
      if (
        finding.provider !== "GitHub Code Scanning / CodeQL" ||
        finding.repository?.provider !== "GITHUB" ||
        !installationId ||
        !Number.isSafeInteger(alertNumber) ||
        alertNumber <= 0
      ) {
        return c.json(
          {
            data: null,
            error: {
              code: "PROVIDER_VERIFICATION_UNSUPPORTED",
              message:
                "This finding does not have a verifiable GitHub Code Scanning alert identity.",
            },
          },
          409,
        );
      }

      const { githubApiRequest } = await import("@ai-sdlc/github");
      const owner = encodeURIComponent(finding.repository.owner);
      const repository = encodeURIComponent(finding.repository.name);
      const alert = await githubApiRequest<{
        number?: number;
        state?: string;
        html_url?: string;
      }>(installationId, `/repos/${owner}/${repository}/code-scanning/alerts/${alertNumber}`);
      if (
        alert.number !== alertNumber ||
        typeof alert.state !== "string" ||
        alert.state.toLowerCase() !== "fixed"
      ) {
        return c.json(
          {
            data: null,
            error: {
              code: "PROVIDER_NOT_RESOLVED",
              message: "GitHub has not confirmed this Code Scanning alert as fixed.",
            },
          },
          409,
        );
      }

      const observedAt = new Date();
      const result = await prisma.$transaction(async (tx) => {
        const changed = await tx.securityFinding.updateMany({
          where: {
            id: finding.id,
            organizationId,
            status: finding.status,
          },
          data: {
            status: "RESOLVED",
            resolutionVerification: "PROVIDER_VERIFIED",
            resolvedAt: observedAt,
          },
        });
        if (changed.count !== 1) return null;
        const updated = await tx.securityFinding.findUniqueOrThrow({
          where: { id: finding.id },
          select: {
            id: true,
            status: true,
            resolutionVerification: true,
            resolvedAt: true,
            updatedAt: true,
          },
        });
        await tx.findingActivity.create({
          data: {
            organizationId,
            findingId: finding.id,
            actorId: userId,
            type: "STATUS_CHANGED",
            fromStatus: finding.status,
            toStatus: "RESOLVED",
            comment: "GitHub Code Scanning confirmed the alert is fixed.",
          },
        });
        const evidence = await tx.findingResolutionEvidence.create({
          data: {
            organizationId,
            securityFindingId: finding.id,
            provider: "GITHUB_CODE_SCANNING",
            providerFindingId: String(alertNumber),
            providerState: "fixed",
            externalRef: typeof alert.html_url === "string" ? alert.html_url : null,
            observedAt,
            metadata: {
              repository: `${finding.repository?.owner}/${finding.repository?.name}`,
              alertNumber,
            },
          },
        });
        return { finding: updated, evidence };
      });
      if (!result) {
        return c.json(
          {
            data: null,
            error: {
              code: "FINDING_NOT_ELIGIBLE",
              message: "The finding changed while provider verification was running.",
            },
          },
          409,
        );
      }
      await recordAuditEvent({
        organizationId,
        actorId: userId,
        eventType: "SECURITY_FINDING_UPDATED",
        metadata: {
          findingId,
          status: "RESOLVED",
          resolutionVerification: "PROVIDER_VERIFIED",
          provider: "GITHUB_CODE_SCANNING",
          providerFindingId: String(alertNumber),
        },
      });
      return c.json({ data: result, error: null });
    },
  );

  app.get(
    "/api/organizations/:organizationId/findings",
    requireAuth,
    requireOrganizationRole("VIEWER"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const status = c.req.query("status");
      const severity = c.req.query("severity");
      const assigneeId = c.req.query("assigneeId");
      const overdue = c.req.query("overdue");
      if (status && !FINDING_STATUSES.has(status)) {
        return error(c, "VALIDATION_ERROR", "Unsupported finding status");
      }
      if (overdue && overdue !== "true" && overdue !== "false") {
        return error(c, "VALIDATION_ERROR", "overdue must be true or false");
      }

      const findings = await prisma.securityFinding.findMany({
        where: {
          organizationId,
          ...(status ? { status } : {}),
          ...(severity ? { severity } : {}),
          ...(assigneeId ? { assigneeId } : {}),
          ...(overdue === "true"
            ? {
                AND: [
                  { dueAt: { lt: new Date() } },
                  { status: { notIn: ["RESOLVED", "ACCEPTED", "FALSE_POSITIVE"] } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 100,
        select: {
          id: true,
          provider: true,
          category: true,
          severity: true,
          title: true,
          description: true,
          file: true,
          line: true,
          status: true,
          resolutionVerification: true,
          dueAt: true,
          resolvedAt: true,
          createdAt: true,
          updatedAt: true,
          assigneeId: true,
          repository: { select: { owner: true, name: true } },
          pullRequest: { select: { id: true, number: true, title: true } },
          assignee: { select: { id: true, name: true, email: true, username: true } },
          activities: {
            orderBy: { createdAt: "desc" },
            take: 25,
            include: { actor: { select: { id: true, name: true, username: true } } },
          },
          riskAcceptances: {
            where: { status: "ACCEPTED" },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { expiresAt: true, reason: true },
          },
        },
      });
      return c.json({ data: findings, error: null });
    },
  );

  app.patch(
    "/api/organizations/:organizationId/findings/:findingId",
    requireAuth,
    requireOrganizationRole("ENGINEER"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const userId = c.get("userId");
      const findingId = c.req.param("findingId");
      if (!findingId) return error(c, "VALIDATION_ERROR", "findingId is required");
      const body = await readJsonObject(c);
      if (!body) return error(c, "VALIDATION_ERROR", "A JSON object is required");

      const current = await prisma.securityFinding.findFirst({
        where: { id: findingId, organizationId },
        include: {
          riskAcceptances: {
            where: { status: "ACCEPTED" },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      });
      if (!current) {
        return c.json(
          { data: null, error: { code: "NOT_FOUND", message: "Finding not found" } },
          404,
        );
      }

      const hasStatus = Object.hasOwn(body, "status");
      const hasAssignee = Object.hasOwn(body, "assigneeId");
      const hasDueAt = Object.hasOwn(body, "dueAt");
      const comment = typeof body["comment"] === "string" ? body["comment"].trim() : "";
      if (!hasStatus && !hasAssignee && !hasDueAt) {
        return error(c, "VALIDATION_ERROR", "At least one workflow field must be provided");
      }

      let status: string | undefined;
      if (hasStatus) {
        const bodyStatus = body["status"];
        if (typeof bodyStatus !== "string" || !FINDING_STATUSES.has(bodyStatus)) {
          return error(c, "VALIDATION_ERROR", "Unsupported finding status");
        }
        status = bodyStatus;
        if (status !== current.status && !ALLOWED_TRANSITIONS[current.status]?.has(status)) {
          return error(
            c,
            "INVALID_TRANSITION",
            `Cannot transition finding from ${current.status} to ${status}`,
          );
        }
        if (status === "ACCEPTED" && !comment) {
          return error(c, "VALIDATION_ERROR", "An acceptance reason is required");
        }
      }

      let assigneeId: string | null | undefined;
      if (hasAssignee) {
        const bodyAssigneeId = body["assigneeId"];
        if (bodyAssigneeId !== null && typeof bodyAssigneeId !== "string") {
          return error(c, "VALIDATION_ERROR", "assigneeId must be a user ID or null");
        }
        assigneeId = bodyAssigneeId;
        if (assigneeId) {
          const member = await prisma.organizationMember.findFirst({
            where: {
              organizationId,
              userId: assigneeId,
              scimActive: true,
              user: { active: true },
            },
            select: { userId: true },
          });
          if (!member) {
            return error(c, "INVALID_ASSIGNEE", "Assignee must be an active organization member");
          }
        }
      }

      let dueAt: Date | null | undefined;
      if (hasDueAt) {
        const bodyDueAt = body["dueAt"];
        if (bodyDueAt === null) {
          dueAt = null;
        } else if (typeof bodyDueAt === "string" && Number.isFinite(Date.parse(bodyDueAt))) {
          dueAt = new Date(bodyDueAt);
        } else {
          return error(c, "VALIDATION_ERROR", "dueAt must be an ISO date-time or null");
        }
      }
      if (
        body["comment"] !== undefined &&
        (typeof body["comment"] !== "string" || comment.length > 4000)
      ) {
        return error(c, "VALIDATION_ERROR", "comment must be a string of at most 4000 characters");
      }
      let acceptanceExpiresAt: Date | undefined;
      if (status === "ACCEPTED") {
        if (
          typeof body["acceptanceExpiresAt"] !== "string" ||
          !Number.isFinite(Date.parse(body["acceptanceExpiresAt"])) ||
          Date.parse(body["acceptanceExpiresAt"]) <= Date.now()
        ) {
          return error(
            c,
            "VALIDATION_ERROR",
            "A future acceptanceExpiresAt date-time is required for risk acceptance",
          );
        }
        acceptanceExpiresAt = new Date(body["acceptanceExpiresAt"]);
      }

      const updated = await prisma.$transaction(async (tx) => {
        const finding = await tx.securityFinding.update({
          where: { id: current.id },
          select: {
            id: true,
            status: true,
            resolutionVerification: true,
            assigneeId: true,
            dueAt: true,
            resolvedAt: true,
            updatedAt: true,
            title: true,
            severity: true,
          },
          data: {
            ...(status ? { status } : {}),
            ...(status && status !== current.status
              ? {
                  resolutionVerification: status === "RESOLVED" ? "USER_REPORTED" : "NOT_VERIFIED",
                }
              : {}),
            ...(hasStatus
              ? {
                  resolvedAt: ["RESOLVED", "ACCEPTED", "FALSE_POSITIVE"].includes(status ?? "")
                    ? (current.resolvedAt ?? new Date())
                    : null,
                }
              : {}),
            ...(hasAssignee ? { assigneeId } : {}),
            ...(hasDueAt ? { dueAt } : {}),
          },
        });
        const activities = [];
        if (status && status !== current.status) {
          activities.push(
            await tx.findingActivity.create({
              data: {
                organizationId,
                findingId,
                actorId: userId,
                type: "STATUS_CHANGED",
                fromStatus: current.status,
                toStatus: status,
                comment: comment || null,
              },
            }),
          );
        } else if (comment) {
          activities.push(
            await tx.findingActivity.create({
              data: { organizationId, findingId, actorId: userId, type: "COMMENT", comment },
            }),
          );
        }
        if (hasAssignee && assigneeId !== current.assigneeId) {
          activities.push(
            await tx.findingActivity.create({
              data: { organizationId, findingId, actorId: userId, type: "ASSIGNED" },
            }),
          );
        }
        if (hasDueAt && dueAt?.toISOString() !== current.dueAt?.toISOString()) {
          activities.push(
            await tx.findingActivity.create({
              data: { organizationId, findingId, actorId: userId, type: "DUE_DATE_CHANGED" },
            }),
          );
        }
        if (status === "ACCEPTED") {
          const activeAcceptance = current.riskAcceptances[0];
          if (activeAcceptance) {
            await tx.riskAcceptance.update({
              where: { id: activeAcceptance.id },
              data: {
                acceptedBy: userId,
                reason: comment,
                expiresAt: acceptanceExpiresAt,
              },
            });
          } else {
            await tx.riskAcceptance.create({
              data: {
                organizationId,
                findingId,
                acceptedBy: userId,
                reason: comment,
                expiresAt: acceptanceExpiresAt,
              },
            });
          }
        } else if (status === "OPEN" && current.status === "ACCEPTED") {
          await tx.riskAcceptance.updateMany({
            where: { organizationId, findingId, status: "ACCEPTED" },
            data: { status: "REVOKED" },
          });
        }
        return { finding, activities };
      });

      await recordAuditEvent({
        organizationId,
        actorId: userId,
        eventType: "SECURITY_FINDING_UPDATED",
        metadata: {
          findingId,
          status: updated.finding.status,
          assigneeId: updated.finding.assigneeId,
        },
      });

      let notificationEmailStatus: string | null = null;
      if (hasAssignee && assigneeId && assigneeId !== userId && assigneeId !== current.assigneeId) {
        try {
          const notification = await createUserNotification({
            organizationId,
            userId: assigneeId,
            type: "FINDING_ASSIGNED",
            title: "Security finding assigned",
            body: current.title,
            href: "/dashboard/findings",
            dedupeKey: `finding:${findingId}:assigned:${assigneeId}:${updated.finding.updatedAt.toISOString()}`,
          });
          notificationEmailStatus = notification.emailStatus;
        } catch (cause) {
          console.error("[remediation] assignment notification could not be persisted", cause);
        }
      }

      return c.json({
        data: { ...updated.finding, activities: updated.activities, notificationEmailStatus },
        error: null,
      });
    },
  );

  app.post(
    "/api/organizations/:organizationId/findings/:findingId/comments",
    requireAuth,
    requireOrganizationRole("ENGINEER"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const userId = c.get("userId");
      const findingId = c.req.param("findingId");
      if (!findingId) return error(c, "VALIDATION_ERROR", "findingId is required");
      const body = await readJsonObject(c);
      const comment = typeof body?.["comment"] === "string" ? body["comment"].trim() : "";
      if (!comment || comment.length > 4000) {
        return error(c, "VALIDATION_ERROR", "comment must contain 1 to 4000 characters");
      }
      const finding = await prisma.securityFinding.findFirst({
        where: { id: findingId, organizationId },
        select: { id: true },
      });
      if (!finding) {
        return c.json(
          { data: null, error: { code: "NOT_FOUND", message: "Finding not found" } },
          404,
        );
      }
      const activity = await prisma.findingActivity.create({
        data: {
          organizationId,
          findingId,
          actorId: userId,
          type: "COMMENT",
          comment,
        },
        include: { actor: { select: { id: true, name: true, username: true } } },
      });
      await recordAuditEvent({
        organizationId,
        actorId: userId,
        eventType: "SECURITY_FINDING_COMMENTED",
        metadata: { findingId, activityId: activity.id },
      });
      return c.json({ data: activity, error: null }, 201);
    },
  );
}
