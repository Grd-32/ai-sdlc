/**
 * Dashboard REST routes (README §42/§43). Every route below :organizationId
 * is gated by requireAuth + requireOrganizationRole, and reads the
 * middleware-verified organizationId (c.get("organizationId")) — never the
 * raw route param — for every query. See middleware/auth.ts.
 *
 * Business logic lives inline here for now rather than in a separate service
 * package — these are straightforward read queries with no branching logic
 * to speak of. Worth extracting to packages/dashboard (or similar) once
 * these queries grow filters/pagination/aggregation complex enough to be
 * independently testable — flagging per README dev rule #5, not doing it
 * preemptively for six thin list endpoints.
 */

import type { Hono } from "hono";
import { getPolicyEnforcementApprovalStatuses, prisma, recordAuditEvent } from "@ai-sdlc/db";
import { requireAuth, requireOrganizationRole } from "../middleware/auth.js";
import { redactSensitiveFields } from "../security/redaction.js";
import type { AppEnv } from "../types.js";

export function registerOrganizationRoutes(app: Hono<AppEnv>): void {
  /** Organizations the signed-in user belongs to. */
  app.get("/api/organizations", requireAuth, async (c) => {
    const userId = c.get("userId");

    const memberships = await prisma.organizationMember.findMany({
      where: { userId },
      select: {
        role: true,
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
            policyApprovalQuorum: true,
            ssoEnforced: true,
            identityProviders: {
              where: { enabled: true },
              select: { id: true },
            },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return c.json({
      data: memberships
        .filter((membership) => {
          if (!membership.organization.ssoEnforced) return true;
          return (
            c.get("authenticationMethod") !== "GITHUB" &&
            membership.organization.identityProviders.some(
              (provider) => provider.id === c.get("identityProviderId"),
            )
          );
        })
        .map((m) => ({
          id: m.organization.id,
          name: m.organization.name,
          slug: m.organization.slug,
          policyApprovalQuorum: m.organization.policyApprovalQuorum,
          role: m.role,
          ssoEnforced: m.organization.ssoEnforced,
        })),
      error: null,
    });
  });

  app.get(
    "/api/organizations/:organizationId/export",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const organization = await prisma.organization.findUnique({
        where: { id: organizationId },
        include: {
          members: {
            select: {
              id: true,
              userId: true,
              role: true,
              externalId: true,
              scimActive: true,
              createdAt: true,
              user: { select: { id: true, email: true, name: true, username: true, active: true } },
            },
          },
          installations: true,
          repositories: true,
          pullRequests: true,
          commits: true,
          aiActivities: true,
          codeChanges: true,
          findings: true,
          riskAssessments: true,
          policies: { include: { policyRules: true } },
          policyRules: true,
          policyDecisions: true,
          reviews: true,
          evidence: true,
          passports: true,
          auditEvents: true,
          webhookEvents: true,
          domains: true,
          environments: true,
          identityProviders: true,
          scimTokens: true,
          serviceAccounts: true,
          apiKeys: true,
          aiProviders: true,
          aiAgents: true,
          aiModels: true,
          sbomComponents: true,
          riskAcceptances: true,
          observabilityEvents: true,
          assessments: { include: { repositories: true } },
        },
      });

      if (!organization) {
        return c.json(
          { data: null, error: { code: "NOT_FOUND", message: "Organization not found" } },
          404,
        );
      }

      await recordAuditEvent({
        organizationId,
        actorId: c.get("userId"),
        eventType: "ORGANIZATION_DATA_EXPORTED",
        metadata: { exportFormatVersion: 1 },
      });

      c.header(
        "Content-Disposition",
        `attachment; filename="organization-${encodeURIComponent(organizationId)}-export.json"`,
      );
      return c.json({
        data: {
          exportFormatVersion: 1,
          exportedAt: new Date().toISOString(),
          organization: redactSensitiveFields(organization),
        },
        error: null,
      });
    },
  );

  /** README §43 — overview metrics. */
  app.get(
    "/api/organizations/:organizationId/overview",
    requireAuth,
    requireOrganizationRole("VIEWER"),
    async (c) => {
      const organizationId = c.get("organizationId");

      const [latestAiActivities, riskAssessments, policyDecisions, totalPassports] =
        await Promise.all([
          prisma.aIActivity.findMany({
            where: { organizationId, pullRequestId: { not: null } },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            distinct: ["pullRequestId"],
            select: { involvement: true },
          }),
          prisma.riskAssessment.findMany({
            where: { organizationId },
            select: { level: true, pullRequestId: true },
            orderBy: { createdAt: "desc" },
            distinct: ["pullRequestId"],
          }),
          prisma.policyDecision.findMany({
            where: { organizationId },
            select: { action: true, pullRequestId: true },
            orderBy: { createdAt: "desc" },
            distinct: ["pullRequestId"],
          }),
          prisma.changePassport.count({ where: { organizationId } }),
        ]);

      return c.json({
        data: {
          aiAssistedPullRequests: latestAiActivities.filter(
            (activity) => activity.involvement === "YES",
          ).length,
          unattributedPullRequests: latestAiActivities.filter(
            (activity) => activity.involvement === "UNKNOWN",
          ).length,
          highRiskChanges: riskAssessments.filter((r) => r.level === "HIGH").length,
          criticalChanges: riskAssessments.filter((r) => r.level === "CRITICAL").length,
          blockedChanges: policyDecisions.filter((p) => p.action === "BLOCK").length,
          reviewRequiredChanges: policyDecisions.filter((p) => p.action === "REVIEW").length,
          totalPassports,
        },
        error: null,
      });
    },
  );

  /** README §42 — Changes table. */
  app.get(
    "/api/organizations/:organizationId/pull-requests",
    requireAuth,
    requireOrganizationRole("VIEWER"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const repositoryId = c.req.query("repositoryId") ?? undefined;
      const state = c.req.query("state") ?? undefined;
      const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 200);

      const pullRequests = await prisma.pullRequest.findMany({
        where: {
          organizationId,
          ...(repositoryId ? { repositoryId } : {}),
          ...(state ? { state } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          number: true,
          title: true,
          state: true,
          authorLogin: true,
          createdAt: true,
          repository: { select: { id: true, owner: true, name: true } },
          aiActivities: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { agent: true, involvement: true, confidence: true },
          },
          riskAssessments: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { level: true, score: true },
          },
          policyDecisions: { orderBy: { createdAt: "desc" }, take: 1, select: { action: true } },
        },
      });

      return c.json({
        data: pullRequests.map((pr) => ({
          id: pr.id,
          number: pr.number,
          title: pr.title,
          state: pr.state,
          author: pr.authorLogin,
          repository: `${pr.repository.owner}/${pr.repository.name}`,
          repositoryId: pr.repository.id,
          aiAgent: pr.aiActivities[0]?.agent ?? null,
          aiInvolvement: pr.aiActivities[0]?.involvement ?? "UNKNOWN",
          aiConfidence: pr.aiActivities[0]?.confidence ?? null,
          riskLevel: pr.riskAssessments[0]?.level ?? null,
          riskScore: pr.riskAssessments[0]?.score ?? null,
          policyAction: pr.policyDecisions[0]?.action ?? null,
          createdAt: pr.createdAt,
        })),
        error: null,
      });
    },
  );

  /** Single change / Change Passport detail. */
  app.get(
    "/api/organizations/:organizationId/pull-requests/:pullRequestId",
    requireAuth,
    requireOrganizationRole("VIEWER"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const pullRequestId = c.req.param("pullRequestId");

      const pullRequest = await prisma.pullRequest.findFirst({
        where: { id: pullRequestId, organizationId },
        include: {
          repository: { select: { owner: true, name: true, criticality: true } },
          aiActivities: { orderBy: { createdAt: "desc" }, take: 1 },
          riskAssessments: { orderBy: { createdAt: "desc" }, take: 1 },
          policyDecisions: { orderBy: { createdAt: "desc" }, take: 1 },
          codeChanges: true,
          findings: true,
          evidence: true,
          reviews: {
            orderBy: { createdAt: "desc" },
            include: {
              reviewer: {
                select: { id: true, name: true, username: true },
              },
            },
          },
          passports: { orderBy: { updatedAt: "desc" }, take: 1 },
        },
      });

      if (!pullRequest) {
        return c.json(
          { data: null, error: { code: "NOT_FOUND", message: "Pull request not found" } },
          404,
        );
      }

      return c.json({ data: pullRequest, error: null });
    },
  );

  /** README §42 — Repositories table. */
  app.get(
    "/api/organizations/:organizationId/repositories",
    requireAuth,
    requireOrganizationRole("VIEWER"),
    async (c) => {
      const organizationId = c.get("organizationId");

      const repositories = await prisma.repository.findMany({
        where: { organizationId },
        orderBy: { name: "asc" },
        select: {
          id: true,
          provider: true,
          owner: true,
          name: true,
          criticality: true,
          enabled: true,
          _count: { select: { pullRequests: true } },
          installation: { select: { permissions: true } },
        },
      });

      return c.json({ data: repositories, error: null });
    },
  );

  /** README §42 — Policies list. */
  app.get(
    "/api/organizations/:organizationId/policies",
    requireAuth,
    requireOrganizationRole("VIEWER"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const canManagePolicies = ["OWNER", "ADMIN"].includes(c.get("organizationRole"));
      const policies = await prisma.policy.findMany({
        where: { organizationId },
        orderBy: { createdAt: "desc" },
        include: {
          policyRules: true,
          ...(canManagePolicies
            ? {
                revisions: {
                  orderBy: { createdAt: "desc" as const },
                  take: 10,
                  select: {
                    id: true,
                    version: true,
                    snapshot: true,
                    createdAt: true,
                  },
                },
              }
            : {}),
        },
      });
      const approvalStatuses = await getPolicyEnforcementApprovalStatuses({
        prisma,
        organizationId,
        policies,
      });
      return c.json({
        data: policies.map((policy) => {
          const enforcementApproval = approvalStatuses.get(policy.id);
          if (!enforcementApproval) {
            throw new Error(`Missing enforcement approval status for policy ${policy.id}.`);
          }
          return {
            ...policy,
            enforcementApproval: canManagePolicies
              ? enforcementApproval
              : {
                  requiredApprovals: enforcementApproval.requiredApprovals,
                  approvalCount: enforcementApproval.approvalCount,
                  approved: enforcementApproval.approved,
                },
          };
        }),
        error: null,
      });
    },
  );

  /** README §42 — Evidence search. */
  app.get(
    "/api/organizations/:organizationId/evidence",
    requireAuth,
    requireOrganizationRole("VIEWER"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const pullRequestId = c.req.query("pullRequestId") ?? undefined;
      const requestedLimit = Number(c.req.query("limit") ?? 100);
      const limit =
        Number.isInteger(requestedLimit) && requestedLimit > 0
          ? Math.min(requestedLimit, 500)
          : 100;
      const evidenceIds = pullRequestId
        ? await prisma.$queryRaw<Array<{ id: string }>>`
            SELECT e."id"
            FROM "Evidence" e
            INNER JOIN "PullRequest" pr ON pr."id" = e."pullRequestId"
            WHERE e."organizationId" = ${organizationId}
              AND e."pullRequestId" = ${pullRequestId}
              AND e."headSha" IS NOT DISTINCT FROM pr."headSha"
            ORDER BY e."createdAt" DESC
            LIMIT ${limit}
          `
        : await prisma.$queryRaw<Array<{ id: string }>>`
            SELECT e."id"
            FROM "Evidence" e
            LEFT JOIN "PullRequest" pr ON pr."id" = e."pullRequestId"
            WHERE e."organizationId" = ${organizationId}
              AND (
                e."pullRequestId" IS NULL
                OR e."headSha" IS NOT DISTINCT FROM pr."headSha"
              )
            ORDER BY e."createdAt" DESC
            LIMIT ${limit}
          `;

      const rows = evidenceIds.length
        ? await prisma.evidence.findMany({
            where: { organizationId, id: { in: evidenceIds.map(({ id }) => id) } },
            include: {
              pullRequest: {
                select: {
                  id: true,
                  number: true,
                  title: true,
                  headSha: true,
                  repository: { select: { owner: true, name: true } },
                },
              },
            },
          })
        : [];
      const evidenceById = new Map(rows.map((item) => [item.id, item]));
      const evidence = evidenceIds.flatMap(({ id }) => {
        const item = evidenceById.get(id);
        return item ? [item] : [];
      });

      return c.json({ data: evidence, error: null });
    },
  );
}
