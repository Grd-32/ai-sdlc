/**
 * AI Agents aggregation (README §42). Grouped in JS rather than a raw SQL
 * GROUP BY across AIActivity/RiskAssessment/PolicyDecision — the dataset per
 * organization is small enough that this is simpler and safer to reason
 * about than hand-written SQL, at the cost of a few extra round trips.
 * Revisit with raw SQL if this ever needs to scale to orgs with very large
 * PR volumes.
 */

import type { Hono } from "hono";
import { prisma } from "@ai-sdlc/db";
import { requireAuth, requireOrganizationRole } from "../middleware/auth.js";
import type { AppEnv } from "../types.js";

export function registerAgentRoutes(app: Hono<AppEnv>): void {
  app.get(
    "/api/organizations/:organizationId/agents",
    requireAuth,
    requireOrganizationRole("VIEWER"),
    async (c) => {
      const organizationId = c.get("organizationId");

      // Latest AI attribution per PR (a PR can have multiple AIActivity rows
      // across pushes if agent/model/source changed — take the most recent).
      const latestActivities = await prisma.aIActivity.findMany({
        where: { organizationId, pullRequestId: { not: null } },
        orderBy: { createdAt: "desc" },
        distinct: ["pullRequestId"],
        select: { agent: true, pullRequestId: true, repositoryId: true },
      });

      const pullRequestIds = latestActivities
        .map((a) => a.pullRequestId)
        .filter((id): id is string => id !== null);

      const [riskAssessments, policyDecisions] = await Promise.all([
        prisma.riskAssessment.findMany({
          where: { organizationId, pullRequestId: { in: pullRequestIds } },
          orderBy: { createdAt: "desc" },
          distinct: ["pullRequestId"],
          select: { pullRequestId: true, score: true },
        }),
        prisma.policyDecision.findMany({
          where: { organizationId, pullRequestId: { in: pullRequestIds } },
          orderBy: { createdAt: "desc" },
          distinct: ["pullRequestId"],
          select: { pullRequestId: true, action: true },
        }),
      ]);

      const riskByPr = new Map(riskAssessments.map((r) => [r.pullRequestId, r.score]));
      const policyByPr = new Map(policyDecisions.map((p) => [p.pullRequestId, p.action]));

      interface AgentBucket {
        pullRequestIds: Set<string>;
        repositoryIds: Set<string>;
        riskScores: number[];
        blockedCount: number;
        reviewRequiredCount: number;
      }

      const byAgent = new Map<string, AgentBucket>();

      for (const activity of latestActivities) {
        if (!activity.pullRequestId) continue;

        const bucket =
          byAgent.get(activity.agent) ??
          ({
            pullRequestIds: new Set<string>(),
            repositoryIds: new Set<string>(),
            riskScores: [],
            blockedCount: 0,
            reviewRequiredCount: 0,
          } satisfies AgentBucket);
        byAgent.set(activity.agent, bucket);

        bucket.pullRequestIds.add(activity.pullRequestId);
        if (activity.repositoryId) {
          bucket.repositoryIds.add(activity.repositoryId);
        }

        const score = riskByPr.get(activity.pullRequestId);
        if (score !== undefined) {
          bucket.riskScores.push(score);
        }

        const action = policyByPr.get(activity.pullRequestId);
        if (action === "BLOCK") bucket.blockedCount += 1;
        if (action === "REVIEW") bucket.reviewRequiredCount += 1;
      }

      const agents = Array.from(byAgent.entries())
        .map(([agent, bucket]) => ({
          agent,
          pullRequestCount: bucket.pullRequestIds.size,
          repositoryCount: bucket.repositoryIds.size,
          averageRiskScore:
            bucket.riskScores.length > 0
              ? Math.round(bucket.riskScores.reduce((sum, s) => sum + s, 0) / bucket.riskScores.length)
              : null,
          blockedCount: bucket.blockedCount,
          reviewRequiredCount: bucket.reviewRequiredCount,
        }))
        .sort((a, b) => b.pullRequestCount - a.pullRequestCount);

      return c.json({ data: agents, error: null });
    },
  );
}