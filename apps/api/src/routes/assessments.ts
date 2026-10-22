import type { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { prisma, recordAuditEvent } from "@ai-sdlc/db";
import { enqueueAssessment } from "../queue.js";
import { requireAuth, requireOrganizationRole } from "../middleware/auth.js";
import { resolveOrganizationEntitlements } from "@ai-sdlc/billing";
import type { AppEnv } from "../types.js";
import { readJsonObject } from "../request-body.js";

const MAX_REPOSITORIES_PER_ASSESSMENT = 10;
const MAX_RETRIES = 3;
const ASSESSMENT_SELECT = {
  id: true,
  status: true,
  windowStart: true,
  windowEnd: true,
  progress: true,
  totalPullRequests: true,
  processedPullRequests: true,
  report: true,
  errorCode: true,
  errorMessage: true,
  attempt: true,
  queuedAt: true,
  startedAt: true,
  completedAt: true,
  cancelledAt: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
  repositories: {
    select: {
      repository: { select: { id: true, owner: true, name: true } },
    },
  },
} as const;

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function toAssessmentResponse(assessment: {
  id: string;
  status: string;
  windowStart: Date;
  windowEnd: Date;
  progress: number;
  totalPullRequests: number;
  processedPullRequests: number;
  report: unknown;
  errorCode: string | null;
  errorMessage: string | null;
  attempt: number;
  queuedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  repositories: Array<{ repository: { id: string; owner: string; name: string } }>;
}) {
  return {
    ...assessment,
    repositories: assessment.repositories.map(({ repository }) => repository),
  };
}

export function registerAssessmentRoutes(app: Hono<AppEnv>): void {
  const route = "/api/organizations/:organizationId/assessments";

  app.get(route, requireAuth, requireOrganizationRole("VIEWER"), async (c) => {
    const organizationId = c.get("organizationId");
    const assessments = await prisma.assessment.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: ASSESSMENT_SELECT,
    });
    return c.json({ data: assessments.map(toAssessmentResponse), error: null });
  });

  app.post(route, requireAuth, requireOrganizationRole("ADMIN"), async (c) => {
    const body = await readJsonObject(c);
    const selectedRepositoryIds: unknown = body?.repositoryIds;
    const repositoryIds = Array.isArray(selectedRepositoryIds)
      ? selectedRepositoryIds.filter((id): id is string => typeof id === "string")
      : [];
    const idempotencyKey =
      c.req.header("Idempotency-Key")?.trim() ||
      (typeof body?.idempotencyKey === "string" ? body.idempotencyKey.trim() : "") ||
      randomUUID();

    if (
      !Array.isArray(selectedRepositoryIds) ||
      selectedRepositoryIds.length === 0 ||
      selectedRepositoryIds.length > MAX_REPOSITORIES_PER_ASSESSMENT ||
      selectedRepositoryIds.some((id) => typeof id !== "string" || id.length > 128) ||
      new Set(selectedRepositoryIds).size !== selectedRepositoryIds.length ||
      body?.dataProcessingAcknowledged !== true ||
      idempotencyKey.length > 128
    ) {
      return c.json(
        {
          data: null,
          error: {
            code: "VALIDATION_ERROR",
            message: `Choose 1-${MAX_REPOSITORIES_PER_ASSESSMENT} distinct repositories and acknowledge the assessment's data processing terms.`,
          },
        },
        400,
      );
    }

    const organizationId = c.get("organizationId");
    const userId = c.get("userId");
    const existing = await prisma.assessment.findFirst({
      where: { organizationId, createdById: userId, idempotencyKey },
      select: ASSESSMENT_SELECT,
    });
    if (existing) {
      return c.json({ data: toAssessmentResponse(existing), error: null });
    }

    const repositories = await prisma.repository.findMany({
      where: {
        id: { in: repositoryIds },
        organizationId,
        enabled: true,
        OR: [
          {
            provider: "GITHUB",
            installation: { is: { active: true, organizationId } },
          },
          {
            provider: "GITLAB",
            sourceControlConnection: {
              is: { active: true, organizationId, provider: "GITLAB" },
            },
          },
          {
            provider: "BITBUCKET",
            sourceControlConnection: {
              is: { active: true, organizationId, provider: "BITBUCKET" },
            },
          },
          {
            provider: "AZURE_DEVOPS",
            sourceControlConnection: {
              is: { active: true, organizationId, provider: "AZURE_DEVOPS" },
            },
          },
        ],
      },
      select: {
        id: true,
        provider: true,
        installation: { select: { permissions: true } },
        sourceControlConnection: { select: { accountName: true, scopes: true } },
      },
    });
    if (repositories.length !== repositoryIds.length) {
      return c.json(
        {
          data: null,
          error: {
            code: "INVALID_REPOSITORY_SCOPE",
            message:
              "One or more selected repositories are unavailable, disabled, or not connected to this organization.",
          },
        },
        400,
      );
    }

    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - 30 * 24 * 60 * 60 * 1000);
    let repositoryLimit = 0;
    let assessment;
    try {
      assessment = await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId})) IS NULL AS locked`;
          const entitlements = await resolveOrganizationEntitlements(organizationId, tx);
          repositoryLimit = entitlements.entitlements.maxRepositories;
          if (repositoryIds.length > repositoryLimit) {
            throw new Error("REPOSITORY_LIMIT_REACHED");
          }
          const connectedRepositories = await tx.repository.count({
            where: { organizationId, enabled: true },
          });
          if (connectedRepositories > repositoryLimit) {
            throw new Error("REPOSITORY_LIMIT_REACHED");
          }
          const consumed = await tx.usageRecord.aggregate({
            where: {
              organizationId,
              type: "ASSESSMENT_ATTEMPT",
              createdAt: {
                gte: entitlements.currentPeriodStart,
                lt: entitlements.currentPeriodEnd,
              },
            },
            _sum: { quantity: true },
          });
          if ((consumed._sum.quantity ?? 0) + 1 > entitlements.entitlements.assessmentsPerMonth) {
            throw new Error("ASSESSMENT_QUOTA_EXCEEDED");
          }
          await tx.usageRecord.create({
            data: {
              organizationId,
              type: "ASSESSMENT_ATTEMPT",
              idempotencyKey: `assessment-attempt:${idempotencyKey}`,
              periodStart: entitlements.currentPeriodStart,
              periodEnd: entitlements.currentPeriodEnd,
              metadata: { repositoryIds },
            },
          });
          return tx.assessment.create({
            data: {
              organizationId,
              createdById: userId,
              status: "QUEUED",
              windowStart,
              windowEnd,
              queuedAt: new Date(),
              attempt: 1,
              idempotencyKey,
              permissionsSnapshot: {
                repositories: repositories.map(
                  ({ id, provider, installation, sourceControlConnection }) =>
                    provider === "GITHUB"
                      ? {
                          repositoryId: id,
                          provider,
                          accessModel:
                            "Existing GitHub App installation; server-side, short-lived installation tokens",
                          requestedByAssessment: false,
                          permissions: installation?.permissions,
                        }
                      : {
                          repositoryId: id,
                          provider,
                          accountName: sourceControlConnection?.accountName,
                          accessModel:
                            provider === "GITLAB"
                              ? "Existing GitLab OAuth connection; encrypted server-side tokens"
                              : provider === "BITBUCKET"
                                ? "Existing Bitbucket OAuth connection; encrypted server-side tokens"
                                : "Existing Azure DevOps Entra OAuth connection; encrypted server-side tokens",
                          grantedScopes: sourceControlConnection?.scopes,
                        },
                ),
              },
              repositories: {
                create: repositories.map(({ id }) => ({ repositoryId: id })),
              },
              expiresAt: new Date(
                windowEnd.getTime() + entitlements.entitlements.retentionDays * 24 * 60 * 60 * 1000,
              ),
            },
            select: ASSESSMENT_SELECT,
          });
        },
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      if (error instanceof Error && error.message === "ASSESSMENT_QUOTA_EXCEEDED") {
        return c.json(
          {
            data: null,
            error: {
              code: "ASSESSMENT_QUOTA_EXCEEDED",
              message:
                "The assessment quota for this organization’s current plan has been reached.",
            },
          },
          429,
        );
      }
      if (error instanceof Error && error.message === "REPOSITORY_LIMIT_REACHED") {
        return c.json(
          {
            data: null,
            error: {
              code: "REPOSITORY_LIMIT_REACHED",
              message: `This plan allows up to ${repositoryLimit} connected repositories.`,
            },
          },
          403,
        );
      }
      if (!isUniqueConstraintError(error)) throw error;
      const duplicate = await prisma.assessment.findFirst({
        where: { organizationId, createdById: userId, idempotencyKey },
        select: ASSESSMENT_SELECT,
      });
      if (!duplicate) throw error;
      return c.json({ data: toAssessmentResponse(duplicate), error: null });
    }

    try {
      await enqueueAssessment({ assessmentId: assessment.id, attempt: assessment.attempt });
    } catch (error) {
      await prisma.assessment.update({
        where: { id: assessment.id },
        data: {
          status: "FAILED",
          errorCode: "ASSESSMENT_QUEUE_UNAVAILABLE",
          errorMessage: "Assessment could not be queued. Please retry.",
        },
      });
      console.error("[assessments] failed to queue assessment", {
        assessmentId: assessment.id,
        error: error instanceof Error ? error.message : "Unknown queue error",
      });
      return c.json(
        {
          data: null,
          error: {
            code: "ASSESSMENT_QUEUE_UNAVAILABLE",
            message: "Assessment could not be queued. Please retry.",
          },
        },
        503,
      );
    }

    await recordAuditEvent({
      organizationId,
      actorId: userId,
      eventType: "ASSESSMENT_AUTHORIZED",
      metadata: {
        assessmentId: assessment.id,
        repositoryIds: repositories.map(({ id }) => id),
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
        dataProcessingAcknowledged: true,
      },
    });
    return c.json({ data: toAssessmentResponse(assessment), error: null }, 202);
  });

  app.get(`${route}/:assessmentId`, requireAuth, requireOrganizationRole("VIEWER"), async (c) => {
    const assessment = await prisma.assessment.findFirst({
      where: { id: c.req.param("assessmentId"), organizationId: c.get("organizationId") },
      select: ASSESSMENT_SELECT,
    });
    if (!assessment) {
      return c.json(
        { data: null, error: { code: "NOT_FOUND", message: "Assessment not found" } },
        404,
      );
    }
    return c.json({ data: toAssessmentResponse(assessment), error: null });
  });

  app.post(
    `${route}/:assessmentId/retry`,
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const assessmentId = c.req.param("assessmentId");
      if (!assessmentId) {
        return c.json(
          { data: null, error: { code: "NOT_FOUND", message: "Assessment not found" } },
          404,
        );
      }
      let retryAttempt: number | null;
      try {
        retryAttempt = await prisma.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId})) IS NULL AS locked`;
            const entitlements = await resolveOrganizationEntitlements(organizationId, tx);
            const previous = await tx.assessment.findFirst({
              where: {
                id: assessmentId,
                organizationId,
                status: "FAILED",
                attempt: { lt: MAX_RETRIES },
              },
              select: { attempt: true },
            });
            if (!previous) return null;

            const consumed = await tx.usageRecord.aggregate({
              where: {
                organizationId,
                type: "ASSESSMENT_ATTEMPT",
                createdAt: {
                  gte: entitlements.currentPeriodStart,
                  lt: entitlements.currentPeriodEnd,
                },
              },
              _sum: { quantity: true },
            });
            if ((consumed._sum.quantity ?? 0) + 1 > entitlements.entitlements.assessmentsPerMonth) {
              return -1;
            }

            const nextAttempt = previous.attempt + 1;
            const updated = await tx.assessment.updateMany({
              where: {
                id: assessmentId,
                organizationId,
                status: "FAILED",
                attempt: previous.attempt,
              },
              data: {
                status: "QUEUED",
                attempt: nextAttempt,
                queuedAt: new Date(),
                startedAt: null,
                completedAt: null,
                progress: 0,
                processedPullRequests: 0,
                totalPullRequests: 0,
                report: undefined,
                errorCode: null,
                errorMessage: null,
              },
            });
            if (updated.count !== 1) return null;
            await tx.usageRecord.create({
              data: {
                organizationId,
                type: "ASSESSMENT_ATTEMPT",
                idempotencyKey: `assessment-attempt:${assessmentId}:${nextAttempt}`,
                periodStart: entitlements.currentPeriodStart,
                periodEnd: entitlements.currentPeriodEnd,
                metadata: { assessmentId, attempt: nextAttempt },
              },
            });
            return nextAttempt;
          },
          { isolationLevel: "Serializable" },
        );
      } catch (error) {
        const code =
          typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
        if (code !== "P2034") throw error;
        retryAttempt = null;
      }
      if (retryAttempt === -1) {
        return c.json(
          {
            data: null,
            error: {
              code: "ASSESSMENT_QUOTA_EXCEEDED",
              message:
                "The assessment quota for this organization’s current plan has been reached.",
            },
          },
          429,
        );
      }
      if (retryAttempt === null) {
        return c.json(
          {
            data: null,
            error: { code: "NOT_RETRYABLE", message: "Assessment is not eligible for retry." },
          },
          409,
        );
      }

      try {
        await enqueueAssessment({ assessmentId, attempt: retryAttempt });
      } catch (error) {
        await prisma.assessment.updateMany({
          where: { id: assessmentId, organizationId, status: "QUEUED" },
          data: {
            status: "FAILED",
            errorCode: "ASSESSMENT_QUEUE_UNAVAILABLE",
            errorMessage: "Assessment could not be queued. Please retry.",
          },
        });
        console.error("[assessments] failed to queue retry", {
          assessmentId,
          error: error instanceof Error ? error.message : "Unknown queue error",
        });
        return c.json(
          {
            data: null,
            error: {
              code: "ASSESSMENT_QUEUE_UNAVAILABLE",
              message: "Assessment could not be queued.",
            },
          },
          503,
        );
      }
      await recordAuditEvent({
        organizationId,
        actorId: c.get("userId"),
        eventType: "ASSESSMENT_RETRIED",
        metadata: { assessmentId, attempt: retryAttempt },
      });
      return c.json(
        { data: { assessmentId, status: "QUEUED", attempt: retryAttempt }, error: null },
        202,
      );
    },
  );

  app.post(
    `${route}/:assessmentId/cancel`,
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const assessmentId = c.req.param("assessmentId");
      const result = await prisma.assessment.updateMany({
        where: {
          id: assessmentId,
          organizationId,
          status: { in: ["CREATED", "AUTHORIZATION_PENDING", "QUEUED", "RUNNING"] },
        },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
      if (result.count !== 1) {
        return c.json(
          {
            data: null,
            error: {
              code: "NOT_CANCELLABLE",
              message: "Assessment cannot be cancelled in its current state.",
            },
          },
          409,
        );
      }
      await recordAuditEvent({
        organizationId,
        actorId: c.get("userId"),
        eventType: "ASSESSMENT_CANCELLED",
        metadata: { assessmentId },
      });
      return c.json({ data: { assessmentId, status: "CANCELLED" }, error: null });
    },
  );

  app.get(
    `${route}/:assessmentId/export`,
    requireAuth,
    requireOrganizationRole("VIEWER"),
    async (c) => {
      const assessment = await prisma.assessment.findFirst({
        where: {
          id: c.req.param("assessmentId"),
          organizationId: c.get("organizationId"),
          status: { in: ["COMPLETED", "COMPLETED_WITH_LIMITATIONS"] },
        },
        select: { id: true, report: true },
      });
      if (!assessment?.report) {
        return c.json(
          {
            data: null,
            error: { code: "REPORT_NOT_READY", message: "A completed report is not available." },
          },
          409,
        );

        app.delete(
          `${route}/:assessmentId`,
          requireAuth,
          requireOrganizationRole("ADMIN"),
          async (c) => {
            const organizationId = c.get("organizationId");
            const assessmentId = c.req.param("assessmentId");
            const assessment = await prisma.assessment.findFirst({
              where: { id: assessmentId, organizationId },
              select: { id: true, status: true },
            });
            if (!assessment) {
              return c.json(
                { data: null, error: { code: "NOT_FOUND", message: "Assessment not found" } },
                404,
              );
            }
            if (
              ["QUEUED", "RUNNING", "CREATED", "AUTHORIZATION_PENDING"].includes(assessment.status)
            ) {
              return c.json(
                {
                  data: null,
                  error: {
                    code: "ASSESSMENT_ACTIVE",
                    message: "Cancel the assessment before deleting its report.",
                  },
                },
                409,
              );
            }
            await recordAuditEvent({
              organizationId,
              actorId: c.get("userId"),
              eventType: "ASSESSMENT_DELETED",
              metadata: { assessmentId },
            });
            await prisma.assessment.delete({ where: { id: assessmentId } });
            return c.json({ data: { assessmentId, deleted: true }, error: null });
          },
        );
      }
      await recordAuditEvent({
        organizationId: c.get("organizationId"),
        actorId: c.get("userId"),
        eventType: "ASSESSMENT_REPORT_EXPORTED",
        metadata: { assessmentId: assessment.id },
      });
      c.header("Content-Type", "application/json; charset=utf-8");
      c.header(
        "Content-Disposition",
        `attachment; filename="nomalog-assessment-${assessment.id}.json"`,
      );
      c.header("Cache-Control", "private, no-store");
      return c.body(JSON.stringify(assessment.report, null, 2));
    },
  );
}
