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
import { prisma } from "@ai-sdlc/db";
import { requireAuth, requireOrganizationRole } from "../middleware/auth.js";
import type { AppEnv } from "../types.js";

export function registerOrganizationRoutes(app: Hono<AppEnv>): void {
  /** Organizations the signed-in user belongs to. */
  app.get("/api/organizations", requireAuth, async (c) => {
    const userId = c.get("userId");

    const memberships = await prisma.organizationMember.findMany({
      where: { userId },
      select: {
        role: true,
        organization: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    return c.json({
      data: memberships.map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
        slug: m.organization.slug,
        role: m.role,
      })),
      error: null,
    });
  });

  /** README §43 — overview metrics. */
  app.get(
    "/api/organizations/:organizationId/overview",
    requireAuth,
    requireOrganizationRole("VIEWER"),
    async (c) => {
      const organizationId = c.get("organizationId");

      const [aiAssistedPrs, riskAssessments, policyDecisions, totalPassports] = await Promise.all([
        prisma.aIActivity.count({ where: { organizationId, involvement: "YES" } }),
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
          aiAssistedPullRequests: aiAssistedPrs,
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
          riskAssessments: { orderBy: { createdAt: "desc" }, take: 1, select: { level: true, score: true } },
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
          reviews: true,
          passports: { orderBy: { updatedAt: "desc" }, take: 1 },
        },
      });

      if (!pullRequest) {
        return c.json({ data: null, error: { code: "NOT_FOUND", message: "Pull request not found" } }, 404);
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
          owner: true,
          name: true,
          criticality: true,
          enabled: true,
          _count: { select: { pullRequests: true } },
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
      const policies = await prisma.policy.findMany({
        where: { organizationId },
        orderBy: { createdAt: "desc" },
        include: { policyRules: true },
      });
      return c.json({ data: policies, error: null });
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
      const limit = Math.min(Number(c.req.query("limit") ?? 100) || 100, 500);

      const evidence = await prisma.evidence.findMany({
        where: { organizationId, ...(pullRequestId ? { pullRequestId } : {}) },
        orderBy: { createdAt: "desc" },
        take: limit,
      });

      return c.json({ data: evidence, error: null });
    },
  );
}