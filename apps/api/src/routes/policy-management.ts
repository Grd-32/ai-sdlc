// /**
//  * Policy management CRUD (README §42 — create/edit/enable/disable/manage).
//  * Gated at ADMIN+ — authoring policy that affects real ALLOW/REVIEW/BLOCK
//  * decisions is a significant, security-relevant administrative action,
//  * matching the gate already used for connecting GitHub installations.
//  *
//  * Validates nested condition expressions against a bounded, typed AST.
//  * VALID_SENSITIVE_AREAS is duplicated from
//  * @ai-sdlc/risk's SensitiveArea type, since that package only exports the
//  * type, not a runtime array of valid values — keep in sync if the risk
//  * package's sensitive-area list changes.
//  */

// import type { Hono } from "hono";
// import { prisma, recordAuditEvent } from "@ai-sdlc/db";
// import { requireAuth, requireOrganizationRole } from "../middleware/auth.js";
// import type { AppEnv } from "../types.js";

// const VALID_ACTIONS = new Set(["ALLOW", "REVIEW", "BLOCK"]);

// const VALID_SENSITIVE_AREAS = new Set([
//   "AUTHENTICATION",
//   "AUTHORIZATION",
//   "PAYMENTS",
//   "CRYPTOGRAPHY",
//   "SECRETS",
//   "DATABASE",
//   "PERSONAL_DATA",
//   "INFRASTRUCTURE",
//   "NETWORKING",
//   "API",
//   "DEPENDENCIES",
//   "CI_CD",
//   "CONTAINERS",
//   "LOGGING",
//   "FRONTEND",
//   "TESTING",
//   "DOCUMENTATION",
// ]);

// const VALID_CRITICALITY = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

// function stringArray(value: unknown, allowed?: Set<string>): string[] {
//   if (!Array.isArray(value)) {
//     return [];
//   }
//   return value.filter(
//     (item): item is string => typeof item === "string" && (!allowed || allowed.has(item)),
//   );
// }

// export function registerPolicyManagementRoutes(app: Hono<AppEnv>): void {
//   app.post(
//     "/api/organizations/:organizationId/policies",
//     requireAuth,
//     requireOrganizationRole("ADMIN"),
//     async (c) => {
//       const organizationId = c.get("organizationId");
//       const userId = c.get("userId");
//       const body = await c.req.json().catch(() => null);

//       const name = typeof body?.name === "string" ? body.name.trim() : "";
//       if (!name) {
//         return c.json({ data: null, error: { code: "VALIDATION_ERROR", message: "name is required" } }, 400);
//       }
//       const description = typeof body?.description === "string" ? body.description.trim() || null : null;

//       const policy = await prisma.policy.create({
//         data: { organizationId, name, description, enabled: true },
//       });

//       await recordAuditEvent({
//         organizationId,
//         eventType: "POLICY_CREATED",
//         actorId: userId,
//         metadata: { policyId: policy.id, name },
//       });

//       return c.json({ data: policy, error: null }, 201);
//     },
//   );

//   app.patch(
//     "/api/organizations/:organizationId/policies/:policyId",
//     requireAuth,
//     requireOrganizationRole("ADMIN"),
//     async (c) => {
//       const organizationId = c.get("organizationId");
//       const userId = c.get("userId");
//       const policyId = c.req.param("policyId");
//       if (!policyId) {
//         return c.json({ data: null, error: { code: "VALIDATION_ERROR", message: "policyId is required" } }, 400);
//       }
//       const body = await c.req.json().catch(() => null);

//       const existing = await prisma.policy.findFirst({ where: { id: policyId, organizationId } });
//       if (!existing) {
//         return c.json({ data: null, error: { code: "NOT_FOUND", message: "Policy not found" } }, 404);
//       }

//       const data: { name?: string; description?: string | null; enabled?: boolean } = {};
//       if (typeof body?.name === "string" && body.name.trim()) data.name = body.name.trim();
//       if (typeof body?.description === "string") data.description = body.description.trim() || null;
//       if (typeof body?.enabled === "boolean") data.enabled = body.enabled;

//       const policy = await prisma.policy.update({ where: { id: policyId }, data });

//       await recordAuditEvent({
//         organizationId,
//         eventType: "POLICY_UPDATED",
//         actorId: userId,
//         metadata: { policyId, changes: data },
//       });

//       return c.json({ data: policy, error: null });
//     },
//   );

//   app.delete(
//     "/api/organizations/:organizationId/policies/:policyId",
//     requireAuth,
//     requireOrganizationRole("ADMIN"),
//     async (c) => {
//       const organizationId = c.get("organizationId");
//       const userId = c.get("userId");
//       const policyId = c.req.param("policyId");
//       if (!policyId) {
//         return c.json({ data: null, error: { code: "VALIDATION_ERROR", message: "policyId is required" } }, 400);
//       }

//       const existing = await prisma.policy.findFirst({ where: { id: policyId, organizationId } });
//       if (!existing) {
//         return c.json({ data: null, error: { code: "NOT_FOUND", message: "Policy not found" } }, 404);
//       }

//       // PolicyRule rows cascade-delete via the FK's onDelete: Cascade.
//       await prisma.policy.delete({ where: { id: policyId } });

//       await recordAuditEvent({
//         organizationId,
//         eventType: "POLICY_DELETED",
//         actorId: userId,
//         metadata: { policyId, name: existing.name },
//       });

//       return c.json({ data: { deleted: true }, error: null });
//     },
//   );

//   app.post(
//     "/api/organizations/:organizationId/policies/:policyId/rules",
//     requireAuth,
//     requireOrganizationRole("ADMIN"),
//     async (c) => {
//       const organizationId = c.get("organizationId");
//       const userId = c.get("userId");
//       const policyId = c.req.param("policyId");
//       if (!policyId) {
//         return c.json({ data: null, error: { code: "VALIDATION_ERROR", message: "policyId is required" } }, 400);
//       }
//       const body = await c.req.json().catch(() => null);

//       const policy = await prisma.policy.findFirst({ where: { id: policyId, organizationId } });
//       if (!policy) {
//         return c.json({ data: null, error: { code: "NOT_FOUND", message: "Policy not found" } }, 404);
//       }

//       const name = typeof body?.name === "string" ? body.name.trim() : "";
//       const actionInput = typeof body?.action === "string" ? body.action : "";
//       if (!name || !VALID_ACTIONS.has(actionInput)) {
//         return c.json(
//           {
//             data: null,
//             error: {
//               code: "VALIDATION_ERROR",
//               message: "name and a valid action (ALLOW/REVIEW/BLOCK) are required",
//             },
//           },
//           400,
//         );
//       }
//       const action = actionInput as "ALLOW" | "REVIEW" | "BLOCK";

//       const sensitiveAreas = stringArray(body?.sensitiveAreas, VALID_SENSITIVE_AREAS);
//       const repositoryCriticalityIn = stringArray(body?.repositoryCriticalityIn, VALID_CRITICALITY);
//       const requiredApprovals = stringArray(body?.requiredApprovals).filter((a) => a.trim().length > 0);
//       const aiInvolved = typeof body?.aiInvolved === "boolean" ? body.aiInvolved : undefined;
//       const riskAtLeast =
//         typeof body?.riskAtLeast === "number" && Number.isFinite(body.riskAtLeast)
//           ? Math.max(0, Math.min(100, Math.round(body.riskAtLeast)))
//           : undefined;
//       const reason = typeof body?.reason === "string" ? body.reason.trim() || undefined : undefined;
//       const precedence = typeof body?.precedence === "number" ? Math.round(body.precedence) : 0;

//       const rule = await prisma.policyRule.create({
//         data: {
//           organizationId,
//           policyId,
//           name,
//           aiInvolved,
//           sensitiveAreas,
//           riskAtLeast,
//           repositoryCriticalityIn,
//           action,
//           requiredApprovals,
//           reason,
//           precedence,
//         },
//       });

//       await recordAuditEvent({
//         organizationId,
//         eventType: "POLICY_UPDATED",
//         actorId: userId,
//         metadata: { policyId, ruleId: rule.id, change: "rule_added" },
//       });

//       return c.json({ data: rule, error: null }, 201);
//     },
//   );

//   app.delete(
//     "/api/organizations/:organizationId/policies/:policyId/rules/:ruleId",
//     requireAuth,
//     requireOrganizationRole("ADMIN"),
//     async (c) => {
//       const organizationId = c.get("organizationId");
//       const userId = c.get("userId");
//       const ruleId = c.req.param("ruleId");
//       if (!ruleId) {
//         return c.json({ data: null, error: { code: "VALIDATION_ERROR", message: "ruleId is required" } }, 400);
//       }

//       const existing = await prisma.policyRule.findFirst({ where: { id: ruleId, organizationId } });
//       if (!existing) {
//         return c.json({ data: null, error: { code: "NOT_FOUND", message: "Policy rule not found" } }, 404);
//       }

//       await prisma.policyRule.delete({ where: { id: ruleId } });

//       await recordAuditEvent({
//         organizationId,
//         eventType: "POLICY_UPDATED",
//         actorId: userId,
//         metadata: { policyId: existing.policyId, ruleId, change: "rule_removed" },
//       });

//       return c.json({ data: { deleted: true }, error: null });
//     },
//   );
// }
/**
 * Policy management CRUD (README §42 — create/edit/enable/disable/manage).
 * Gated at ADMIN+ — authoring policy that affects real ALLOW/REVIEW/BLOCK
 * decisions is a significant, security-relevant administrative action,
 * matching the gate already used for connecting GitHub installations.
 *
 * Nested expressions are validated against the policy package's bounded AST.
 * VALID_SENSITIVE_AREAS is duplicated from
 * @ai-sdlc/risk's SensitiveArea type, since that package only exports the
 * type, not a runtime array of valid values — keep in sync if the risk
 * package's sensitive-area list changes.
 */

import type { Context, Hono, Next } from "hono";
import {
  getPolicyEnforcementApprovalStatuses,
  normalizePolicyMode,
  prisma,
  Prisma,
  recordAuditEvent,
} from "@ai-sdlc/db";
import { requireAuth, requireOrganizationRole } from "../middleware/auth.js";
import {
  parsePolicyCondition,
  resolveApprovalRequirements,
  simulatePolicyHistory,
  type PolicyRule,
  type PolicySimulationRecord,
  type SensitiveArea,
} from "@ai-sdlc/policy";
import { resolveOrganizationEntitlements } from "@ai-sdlc/billing";
import type { AppEnv } from "../types.js";
import { readJsonObject } from "../request-body.js";

const VALID_ACTIONS = new Set(["ALLOW", "REVIEW", "BLOCK"]);
const VALID_MODES = new Set(["ENFORCING", "DRY_RUN", "DISABLED"]);

const VALID_SENSITIVE_AREAS = new Set([
  "AUTHENTICATION",
  "AUTHORIZATION",
  "PAYMENTS",
  "CRYPTOGRAPHY",
  "SECRETS",
  "DATABASE",
  "PERSONAL_DATA",
  "INFRASTRUCTURE",
  "NETWORKING",
  "API",
  "DEPENDENCIES",
  "CI_CD",
  "CONTAINERS",
  "LOGGING",
  "FRONTEND",
  "TESTING",
  "DOCUMENTATION",
]);

const VALID_CRITICALITY = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

function parseStringArray(
  value: unknown,
  allowed?: Set<string>,
): { valid: true; values: string[] } | { valid: false } {
  if (value === undefined || value === null) return { valid: true, values: [] };
  if (
    !Array.isArray(value) ||
    !value.every(
      (item) =>
        typeof item === "string" &&
        item.trim().length > 0 &&
        item.trim().length <= 100 &&
        (!allowed || allowed.has(item.trim())),
    )
  ) {
    return { valid: false };
  }
  return { valid: true, values: value.map((item: string) => item.trim()) };
}

async function createPolicyRevision(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  policyId: string,
  actorId: string,
  incrementVersion: boolean,
) {
  const existing = await transaction.policy.findFirst({
    where: { id: policyId, organizationId },
    include: { policyRules: { orderBy: { precedence: "desc" } } },
  });
  if (!existing) {
    throw new Error(
      `Cannot snapshot missing policy ${policyId} in organization ${organizationId}.`,
    );
  }

  const versionMatch = /^v([1-9]\d*)$/.exec(existing.version);
  if (!versionMatch) {
    throw new Error(`Policy ${policyId} has unsupported version value "${existing.version}".`);
  }
  const version = incrementVersion ? `v${Number(versionMatch[1]) + 1}` : existing.version;
  const policy =
    incrementVersion && version !== existing.version
      ? await transaction.policy.update({ where: { id: policyId }, data: { version } })
      : existing;
  const snapshot = JSON.parse(
    JSON.stringify({
      id: policy.id,
      name: policy.name,
      description: policy.description,
      enabled: policy.enabled,
      mode: policy.mode,
      version,
      metadata: policy.metadata,
      policyRules: existing.policyRules.map((rule) => ({
        id: rule.id,
        name: rule.name,
        aiInvolved: rule.aiInvolved,
        conditionExpression: rule.conditionExpression,
        sensitiveAreas: rule.sensitiveAreas,
        riskAtLeast: rule.riskAtLeast,
        repositoryCriticalityIn: rule.repositoryCriticalityIn,
        action: rule.action,
        requiredApprovals: rule.requiredApprovals,
        reason: rule.reason,
        precedence: rule.precedence,
      })),
    }),
  ) as Prisma.InputJsonValue;

  await transaction.policyRevision.create({
    data: { organizationId, policyId, version, actorId, snapshot },
  });
  return policy;
}

export function registerPolicyManagementRoutes(app: Hono<AppEnv>): void {
  const enforcePolicyEntitlement = async (c: Context<AppEnv>, next: Next) => {
    const entitlements = await resolveOrganizationEntitlements(c.get("organizationId"));
    if (!entitlements.entitlements.policyEnforcement || entitlements.billingAccessOnly) {
      return c.json(
        {
          data: null,
          error: {
            code: "PLAN_ENTITLEMENT_REQUIRED",
            message: "Policy management requires a plan that includes policy enforcement.",
          },
        },
        403,
      );
    }
    await next();
  };
  app.use(
    "/api/organizations/:organizationId/policies",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    enforcePolicyEntitlement,
  );
  app.use(
    "/api/organizations/:organizationId/policies/*",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    enforcePolicyEntitlement,
  );

  app.post(
    "/api/organizations/:organizationId/policies/simulate",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const body = await readJsonObject(c);
      const modeInput = typeof body?.mode === "string" ? body.mode.toUpperCase() : "DRY_RUN";
      if (modeInput !== "DRY_RUN" && modeInput !== "ENFORCING") {
        return c.json(
          {
            data: null,
            error: { code: "VALIDATION_ERROR", message: "mode must be DRY_RUN or ENFORCING" },
          },
          400,
        );
      }
      const requestedLimit =
        typeof body?.["limit"] === "number" && Number.isInteger(body["limit"])
          ? body["limit"]
          : 100;
      if (requestedLimit < 1 || requestedLimit > 200) {
        return c.json(
          {
            data: null,
            error: { code: "VALIDATION_ERROR", message: "limit must be between 1 and 200" },
          },
          400,
        );
      }

      const policies = await prisma.policy.findMany({
        where: { organizationId, enabled: true, mode: { not: "DISABLED" } },
        include: { policyRules: { orderBy: { precedence: "desc" } } },
      });
      const rules: PolicyRule[] = policies.flatMap((policy) =>
        policy.policyRules.map((rule) => {
          let conditionExpression: PolicyRule["conditionExpression"];
          if (rule.conditionExpression !== null) {
            const parsedCondition = parsePolicyCondition(rule.conditionExpression);
            if (!parsedCondition.valid) {
              throw new Error(
                `Policy rule ${rule.id} has an invalid condition expression: ${parsedCondition.error}`,
              );
            }
            conditionExpression = parsedCondition.condition;
          }

          return {
            id: rule.id,
            name: `${policy.name}: ${rule.name}`,
            conditions: {
              aiInvolved: rule.aiInvolved ?? undefined,
              sensitiveAreasInclude:
                rule.sensitiveAreas.length > 0
                  ? (rule.sensitiveAreas as SensitiveArea[])
                  : undefined,
              riskAtLeast: rule.riskAtLeast ?? undefined,
              repositoryCriticalityIn:
                rule.repositoryCriticalityIn.length > 0
                  ? (rule.repositoryCriticalityIn as PolicySimulationRecord["repositoryCriticality"][])
                  : undefined,
            },
            conditionExpression,
            action: rule.action,
            requiredApprovals: rule.requiredApprovals.map((type) => ({
              type,
              description: `${type} required by "${policy.name}".`,
            })),
            reason: rule.reason ?? `Matched organization policy "${policy.name}".`,
          };
        }),
      );

      const pullRequests = await prisma.pullRequest.findMany({
        where: { organizationId, lastAnalyzedSha: { not: null } },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: requestedLimit,
        select: {
          id: true,
          number: true,
          title: true,
          headSha: true,
          lastAnalyzedSha: true,
          aiActivities: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { involvement: true, confidence: true },
          },
          riskAssessments: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { score: true, level: true },
          },
          codeChanges: { select: { sensitiveAreas: true } },
          policyDecisions: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { action: true },
          },
          repository: { select: { owner: true, name: true, criticality: true } },
        },
      });

      let skippedStaleAnalysis = 0;
      let skippedMissingRisk = 0;
      const history: PolicySimulationRecord[] = [];
      for (const pullRequest of pullRequests) {
        if (!pullRequest.headSha || pullRequest.headSha !== pullRequest.lastAnalyzedSha) {
          skippedStaleAnalysis += 1;
          continue;
        }
        const risk = pullRequest.riskAssessments[0];
        if (!risk) {
          skippedMissingRisk += 1;
          continue;
        }
        const sensitiveAreas = [
          ...new Set(pullRequest.codeChanges.flatMap((change) => change.sensitiveAreas)),
        ].filter((area): area is SensitiveArea => VALID_SENSITIVE_AREAS.has(area));
        const criticality = pullRequest.repository.criticality;
        if (!VALID_CRITICALITY.has(criticality)) {
          throw new Error(
            `Repository ${pullRequest.repository.owner}/${pullRequest.repository.name} has invalid criticality ${criticality}.`,
          );
        }

        history.push({
          organizationId,
          pullRequestId: pullRequest.id,
          pullRequestNumber: pullRequest.number,
          pullRequestTitle: pullRequest.title,
          repository: `${pullRequest.repository.owner}/${pullRequest.repository.name}`,
          aiInvolvement: pullRequest.aiActivities[0]?.involvement ?? "UNKNOWN",
          aiConfidence: pullRequest.aiActivities[0]?.confidence ?? 0,
          sensitiveAreas,
          riskScore: risk.score,
          riskLevel: risk.level,
          repositoryCriticality: criticality as PolicySimulationRecord["repositoryCriticality"],
          previousAction: pullRequest.policyDecisions[0]?.action,
        });
      }

      const result = simulatePolicyHistory(history, modeInput, rules);
      return c.json({
        data: {
          ...result,
          historyWindow: requestedLimit,
          skippedStaleAnalysis,
          skippedMissingRisk,
        },
        error: null,
      });
    },
  );

  app.post(
    "/api/organizations/:organizationId/policies",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const userId = c.get("userId");
      const body = await readJsonObject(c);

      const name = typeof body?.name === "string" ? body.name.trim() : "";
      if (!name || name.length > 120) {
        return c.json(
          {
            data: null,
            error: {
              code: "VALIDATION_ERROR",
              message: "name is required and must be at most 120 characters",
            },
          },
          400,
        );
      }
      const rawMode = typeof body?.mode === "string" ? body.mode.toUpperCase() : "DRY_RUN";
      if (!VALID_MODES.has(rawMode)) {
        return c.json(
          {
            data: null,
            error: {
              code: "VALIDATION_ERROR",
              message: "mode must be ENFORCING, DRY_RUN, or DISABLED",
            },
          },
          400,
        );
      }
      const description =
        typeof body?.description === "string" ? body.description.trim() || null : null;

      const policy = await prisma.$transaction(async (transaction) => {
        const created = await transaction.policy.create({
          data: {
            organizationId,
            name,
            description,
            enabled: body?.enabled === false ? false : true,
            mode: normalizePolicyMode(rawMode),
          },
        });
        await createPolicyRevision(transaction, organizationId, created.id, userId, false);
        return created;
      });

      await recordAuditEvent({
        organizationId,
        eventType: "POLICY_CREATED",
        actorId: userId,
        metadata: { policyId: policy.id, name },
      });

      return c.json({ data: policy, error: null }, 201);
    },
  );

  app.patch(
    "/api/organizations/:organizationId/policies/:policyId",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const userId = c.get("userId");
      const policyId = c.req.param("policyId");
      if (!policyId) {
        return c.json(
          { data: null, error: { code: "VALIDATION_ERROR", message: "policyId is required" } },
          400,
        );
      }
      const body = await readJsonObject(c);

      const existing = await prisma.policy.findFirst({ where: { id: policyId, organizationId } });
      if (!existing) {
        return c.json(
          { data: null, error: { code: "NOT_FOUND", message: "Policy not found" } },
          404,
        );
      }

      const data: {
        name?: string;
        description?: string | null;
        enabled?: boolean;
        mode?: "ENFORCING" | "DRY_RUN" | "DISABLED";
      } = {};
      if (typeof body?.name === "string" && body.name.trim()) data.name = body.name.trim();
      if (typeof body?.description === "string") data.description = body.description.trim() || null;
      if (typeof body?.enabled === "boolean") data.enabled = body.enabled;
      if (typeof body?.mode === "string") {
        const nextMode = body.mode.toUpperCase();
        if (!VALID_MODES.has(nextMode)) {
          return c.json(
            {
              data: null,
              error: {
                code: "VALIDATION_ERROR",
                message: "mode must be ENFORCING, DRY_RUN, or DISABLED",
              },
            },
            400,
          );
        }
        data.mode = normalizePolicyMode(nextMode);
      }

      const policy = await prisma.$transaction(async (transaction) => {
        await transaction.policy.update({ where: { id: policyId }, data });
        return createPolicyRevision(transaction, organizationId, policyId, userId, true);
      });

      await recordAuditEvent({
        organizationId,
        eventType: "POLICY_UPDATED",
        actorId: userId,
        metadata: { policyId, changes: data },
      });

      return c.json({ data: policy, error: null });
    },
  );

  app.post(
    "/api/organizations/:organizationId/policies/:policyId/approvals",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const userId = c.get("userId");
      const policyId = c.req.param("policyId");
      if (!policyId) {
        return c.json(
          { data: null, error: { code: "VALIDATION_ERROR", message: "policyId is required" } },
          400,
        );
      }
      const policy = await prisma.policy.findFirst({
        where: { id: policyId, organizationId },
        select: { id: true, version: true, mode: true, enabled: true },
      });
      if (!policy) {
        return c.json(
          { data: null, error: { code: "NOT_FOUND", message: "Policy not found" } },
          404,
        );
      }
      if (!policy.enabled || policy.mode !== "ENFORCING") {
        return c.json(
          {
            data: null,
            error: {
              code: "POLICY_NOT_PENDING_ENFORCEMENT",
              message: "Only enabled policies configured for ENFORCING mode can be approved.",
            },
          },
          409,
        );
      }

      const revision = await prisma.policyRevision.findFirst({
        where: { organizationId, policyId, version: policy.version },
        select: { actorId: true },
      });
      if (!revision) {
        throw new Error(`Policy ${policyId} is missing its current revision snapshot.`);
      }
      if (revision.actorId === userId) {
        return c.json(
          {
            data: null,
            error: {
              code: "POLICY_AUTHOR_CANNOT_APPROVE",
              message: "The author of the current policy revision cannot approve it.",
            },
          },
          403,
        );
      }

      const created = await prisma.policyApproval.createMany({
        data: [{ organizationId, policyId, version: policy.version, actorId: userId }],
        skipDuplicates: true,
      });
      if (created.count > 0) {
        await recordAuditEvent({
          organizationId,
          eventType: "POLICY_ENFORCEMENT_APPROVED",
          actorId: userId,
          metadata: { policyId, version: policy.version },
        });
      }

      const approvalStatuses = await getPolicyEnforcementApprovalStatuses({
        prisma,
        organizationId,
        policies: [policy],
      });
      const enforcementApproval = approvalStatuses.get(policy.id);
      if (!enforcementApproval) {
        throw new Error(`Missing enforcement approval status for policy ${policy.id}.`);
      }
      return c.json({ data: enforcementApproval, error: null });
    },
  );

  app.delete(
    "/api/organizations/:organizationId/policies/:policyId",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const userId = c.get("userId");
      const policyId = c.req.param("policyId");
      if (!policyId) {
        return c.json(
          { data: null, error: { code: "VALIDATION_ERROR", message: "policyId is required" } },
          400,
        );
      }

      const existing = await prisma.policy.findFirst({ where: { id: policyId, organizationId } });
      if (!existing) {
        return c.json(
          { data: null, error: { code: "NOT_FOUND", message: "Policy not found" } },
          404,
        );
      }

      await prisma.$transaction(async (transaction) => {
        await createPolicyRevision(transaction, organizationId, policyId, userId, true);
        await transaction.policy.delete({ where: { id: policyId } });
      });

      await recordAuditEvent({
        organizationId,
        eventType: "POLICY_DELETED",
        actorId: userId,
        metadata: { policyId, name: existing.name },
      });

      return c.json({ data: { deleted: true }, error: null });
    },
  );

  app.post(
    "/api/organizations/:organizationId/policies/:policyId/rules",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const userId = c.get("userId");
      const policyId = c.req.param("policyId");
      if (!policyId) {
        return c.json(
          { data: null, error: { code: "VALIDATION_ERROR", message: "policyId is required" } },
          400,
        );
      }
      const body = await readJsonObject(c);

      const policy = await prisma.policy.findFirst({ where: { id: policyId, organizationId } });
      if (!policy) {
        return c.json(
          { data: null, error: { code: "NOT_FOUND", message: "Policy not found" } },
          404,
        );
      }

      const name = typeof body?.name === "string" ? body.name.trim() : "";
      const actionInput = typeof body?.action === "string" ? body.action : "";
      if (!name || name.length > 120 || !VALID_ACTIONS.has(actionInput)) {
        return c.json(
          {
            data: null,
            error: {
              code: "VALIDATION_ERROR",
              message: "name and a valid action (ALLOW/REVIEW/BLOCK) are required",
            },
          },
          400,
        );
      }
      const action = actionInput as "ALLOW" | "REVIEW" | "BLOCK";

      const sensitiveAreasInput = parseStringArray(body?.sensitiveAreas, VALID_SENSITIVE_AREAS);
      const criticalityInput = parseStringArray(body?.repositoryCriticalityIn, VALID_CRITICALITY);
      const requiredApprovalsInput = parseStringArray(body?.requiredApprovals);
      if (!sensitiveAreasInput.valid || !criticalityInput.valid || !requiredApprovalsInput.valid) {
        return c.json(
          {
            data: null,
            error: {
              code: "VALIDATION_ERROR",
              message:
                "sensitiveAreas, repositoryCriticalityIn, and requiredApprovals must be arrays of supported non-empty strings.",
            },
          },
          400,
        );
      }
      const sensitiveAreas = sensitiveAreasInput.values;
      const repositoryCriticalityIn = criticalityInput.values;
      const requiredApprovals = requiredApprovalsInput.values;
      if (action === "REVIEW" && !resolveApprovalRequirements(requiredApprovals)) {
        return c.json(
          {
            data: null,
            error: {
              code: "VALIDATION_ERROR",
              message:
                "Review rules must use supported approval labels: REVIEWER_REVIEW, ENGINEER_REVIEW, SENIOR_ENGINEER_REVIEW, PLATFORM_REVIEW, or SECURITY_REVIEW.",
            },
          },
          400,
        );
      }
      if (
        body?.aiInvolved !== undefined &&
        body.aiInvolved !== null &&
        typeof body.aiInvolved !== "boolean"
      ) {
        return c.json(
          {
            data: null,
            error: { code: "VALIDATION_ERROR", message: "aiInvolved must be a boolean" },
          },
          400,
        );
      }
      if (
        body?.riskAtLeast !== undefined &&
        body.riskAtLeast !== null &&
        (typeof body.riskAtLeast !== "number" ||
          !Number.isFinite(body.riskAtLeast) ||
          body.riskAtLeast < 0 ||
          body.riskAtLeast > 100)
      ) {
        return c.json(
          {
            data: null,
            error: {
              code: "VALIDATION_ERROR",
              message: "riskAtLeast must be a number from 0 to 100",
            },
          },
          400,
        );
      }
      if (
        body?.precedence !== undefined &&
        (typeof body.precedence !== "number" ||
          !Number.isSafeInteger(body.precedence) ||
          Math.abs(body.precedence) > 1000)
      ) {
        return c.json(
          {
            data: null,
            error: {
              code: "VALIDATION_ERROR",
              message: "precedence must be an integer from -1000 to 1000",
            },
          },
          400,
        );
      }
      const aiInvolved = typeof body?.aiInvolved === "boolean" ? body.aiInvolved : undefined;
      const riskAtLeast =
        typeof body?.riskAtLeast === "number" ? Math.round(body.riskAtLeast) : undefined;
      const reason = typeof body?.reason === "string" ? body.reason.trim() || undefined : undefined;
      const precedence = typeof body?.precedence === "number" ? body.precedence : 0;
      let conditionExpression: Prisma.InputJsonValue | Prisma.NullTypes.DbNull = Prisma.DbNull;
      if (body?.["conditionExpression"] !== undefined && body["conditionExpression"] !== null) {
        const parsedCondition = parsePolicyCondition(body["conditionExpression"]);
        if (!parsedCondition.valid) {
          return c.json(
            {
              data: null,
              error: { code: "VALIDATION_ERROR", message: parsedCondition.error },
            },
            400,
          );
        }
        conditionExpression = parsedCondition.condition;
      }

      const rule = await prisma.$transaction(async (transaction) => {
        const created = await transaction.policyRule.create({
          data: {
            organizationId,
            policyId,
            name,
            aiInvolved,
            conditionExpression,
            sensitiveAreas,
            riskAtLeast,
            repositoryCriticalityIn,
            action,
            requiredApprovals,
            reason,
            precedence,
          },
        });
        await createPolicyRevision(transaction, organizationId, policyId, userId, true);
        return created;
      });

      await recordAuditEvent({
        organizationId,
        eventType: "POLICY_UPDATED",
        actorId: userId,
        metadata: { policyId, ruleId: rule.id, change: "rule_added" },
      });

      return c.json({ data: rule, error: null }, 201);
    },
  );

  /**
   * Full-replace PATCH — a form always sends the complete current state of
   * every field, so absent/unchecked fields here mean "clear this
   * condition" (null), not "leave unchanged" (undefined) as they do on
   * create. That's the correct semantic for an edit form: unchecking
   * "AI involved" back to "Any" should actually clear the condition, not
   * silently keep the old value.
   */
  app.patch(
    "/api/organizations/:organizationId/policies/:policyId/rules/:ruleId",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const userId = c.get("userId");
      const policyId = c.req.param("policyId");
      const ruleId = c.req.param("ruleId");
      if (!policyId || !ruleId) {
        return c.json(
          {
            data: null,
            error: { code: "VALIDATION_ERROR", message: "policyId and ruleId are required" },
          },
          400,
        );
      }
      const body = await readJsonObject(c);

      const existing = await prisma.policyRule.findFirst({
        where: { id: ruleId, policyId, organizationId },
      });
      if (!existing) {
        return c.json(
          { data: null, error: { code: "NOT_FOUND", message: "Policy rule not found" } },
          404,
        );
      }

      const name = typeof body?.name === "string" ? body.name.trim() : "";
      const actionInput = typeof body?.action === "string" ? body.action : "";
      if (!name || name.length > 120 || !VALID_ACTIONS.has(actionInput)) {
        return c.json(
          {
            data: null,
            error: {
              code: "VALIDATION_ERROR",
              message: "name and a valid action (ALLOW/REVIEW/BLOCK) are required",
            },
          },
          400,
        );
      }
      const action = actionInput as "ALLOW" | "REVIEW" | "BLOCK";

      const sensitiveAreasInput = parseStringArray(body?.sensitiveAreas, VALID_SENSITIVE_AREAS);
      const criticalityInput = parseStringArray(body?.repositoryCriticalityIn, VALID_CRITICALITY);
      const requiredApprovalsInput = parseStringArray(body?.requiredApprovals);
      if (!sensitiveAreasInput.valid || !criticalityInput.valid || !requiredApprovalsInput.valid) {
        return c.json(
          {
            data: null,
            error: {
              code: "VALIDATION_ERROR",
              message:
                "sensitiveAreas, repositoryCriticalityIn, and requiredApprovals must be arrays of supported non-empty strings.",
            },
          },
          400,
        );
      }
      const sensitiveAreas = sensitiveAreasInput.values;
      const repositoryCriticalityIn = criticalityInput.values;
      const requiredApprovals = requiredApprovalsInput.values;
      if (action === "REVIEW" && !resolveApprovalRequirements(requiredApprovals)) {
        return c.json(
          {
            data: null,
            error: {
              code: "VALIDATION_ERROR",
              message:
                "Review rules must use supported approval labels: REVIEWER_REVIEW, ENGINEER_REVIEW, SENIOR_ENGINEER_REVIEW, PLATFORM_REVIEW, or SECURITY_REVIEW.",
            },
          },
          400,
        );
      }
      if (
        body?.aiInvolved !== undefined &&
        body.aiInvolved !== null &&
        typeof body.aiInvolved !== "boolean"
      ) {
        return c.json(
          {
            data: null,
            error: { code: "VALIDATION_ERROR", message: "aiInvolved must be a boolean" },
          },
          400,
        );
      }
      if (
        body?.riskAtLeast !== undefined &&
        body.riskAtLeast !== null &&
        (typeof body.riskAtLeast !== "number" ||
          !Number.isFinite(body.riskAtLeast) ||
          body.riskAtLeast < 0 ||
          body.riskAtLeast > 100)
      ) {
        return c.json(
          {
            data: null,
            error: {
              code: "VALIDATION_ERROR",
              message: "riskAtLeast must be a number from 0 to 100",
            },
          },
          400,
        );
      }
      if (
        body?.precedence !== undefined &&
        (typeof body.precedence !== "number" ||
          !Number.isSafeInteger(body.precedence) ||
          Math.abs(body.precedence) > 1000)
      ) {
        return c.json(
          {
            data: null,
            error: {
              code: "VALIDATION_ERROR",
              message: "precedence must be an integer from -1000 to 1000",
            },
          },
          400,
        );
      }
      const aiInvolved = typeof body?.aiInvolved === "boolean" ? body.aiInvolved : null;
      const riskAtLeast =
        typeof body?.riskAtLeast === "number" ? Math.round(body.riskAtLeast) : null;
      const reason = typeof body?.reason === "string" ? body.reason.trim() || null : null;
      const precedence =
        typeof body?.precedence === "number" ? body.precedence : existing.precedence;
      let conditionExpression: Prisma.InputJsonValue | Prisma.NullTypes.DbNull | undefined;
      if (body && Object.prototype.hasOwnProperty.call(body, "conditionExpression")) {
        if (body["conditionExpression"] === null || body["conditionExpression"] === undefined) {
          conditionExpression = Prisma.DbNull;
        } else {
          const parsedCondition = parsePolicyCondition(body["conditionExpression"]);
          if (!parsedCondition.valid) {
            return c.json(
              {
                data: null,
                error: { code: "VALIDATION_ERROR", message: parsedCondition.error },
              },
              400,
            );
          }
          conditionExpression = parsedCondition.condition;
        }
      }

      const rule = await prisma.$transaction(async (transaction) => {
        const updated = await transaction.policyRule.update({
          where: { id: ruleId },
          data: {
            name,
            aiInvolved,
            conditionExpression,
            sensitiveAreas,
            riskAtLeast,
            repositoryCriticalityIn,
            action,
            requiredApprovals,
            reason,
            precedence,
          },
        });
        await createPolicyRevision(transaction, organizationId, policyId, userId, true);
        return updated;
      });

      await recordAuditEvent({
        organizationId,
        eventType: "POLICY_UPDATED",
        actorId: userId,
        metadata: { policyId, ruleId, change: "rule_updated" },
      });

      return c.json({ data: rule, error: null });
    },
  );

  app.delete(
    "/api/organizations/:organizationId/policies/:policyId/rules/:ruleId",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const userId = c.get("userId");
      const ruleId = c.req.param("ruleId");
      if (!ruleId) {
        return c.json(
          { data: null, error: { code: "VALIDATION_ERROR", message: "ruleId is required" } },
          400,
        );
      }

      const existing = await prisma.policyRule.findFirst({ where: { id: ruleId, organizationId } });
      if (!existing) {
        return c.json(
          { data: null, error: { code: "NOT_FOUND", message: "Policy rule not found" } },
          404,
        );
      }

      await prisma.$transaction(async (transaction) => {
        await transaction.policyRule.delete({ where: { id: ruleId } });
        await createPolicyRevision(transaction, organizationId, existing.policyId, userId, true);
      });

      await recordAuditEvent({
        organizationId,
        eventType: "POLICY_UPDATED",
        actorId: userId,
        metadata: { policyId: existing.policyId, ruleId, change: "rule_removed" },
      });

      return c.json({ data: { deleted: true }, error: null });
    },
  );
}
