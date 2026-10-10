// /**
//  * Policy management CRUD (README §42 — create/edit/enable/disable/manage).
//  * Gated at ADMIN+ — authoring policy that affects real ALLOW/REVIEW/BLOCK
//  * decisions is a significant, security-relevant administrative action,
//  * matching the gate already used for connecting GitHub installations.
//  *
//  * Deliberately validates against a small, fixed condition shape rather than
//  * a generic field/operator/value DSL — see the schema-change note this
//  * shipped alongside for why. VALID_SENSITIVE_AREAS is duplicated from
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
 * Deliberately validates against a small, fixed condition shape rather than
 * a generic field/operator/value DSL — see the schema-change note this
 * shipped alongside for why. VALID_SENSITIVE_AREAS is duplicated from
 * @ai-sdlc/risk's SensitiveArea type, since that package only exports the
 * type, not a runtime array of valid values — keep in sync if the risk
 * package's sensitive-area list changes.
 */

import type { Hono } from "hono";
import { normalizePolicyMode, prisma, recordAuditEvent } from "@ai-sdlc/db";
import { requireAuth, requireOrganizationRole } from "../middleware/auth.js";
import type { AppEnv } from "../types.js";

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

function stringArray(value: unknown, allowed?: Set<string>): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is string => typeof item === "string" && (!allowed || allowed.has(item)),
  );
}

export function registerPolicyManagementRoutes(app: Hono<AppEnv>): void {
  app.post(
    "/api/organizations/:organizationId/policies",
    requireAuth,
    requireOrganizationRole("ADMIN"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const userId = c.get("userId");
      const body = await c.req.json().catch(() => null);

      const name = typeof body?.name === "string" ? body.name.trim() : "";
      if (!name) {
        return c.json({ data: null, error: { code: "VALIDATION_ERROR", message: "name is required" } }, 400);
      }
      const rawMode = typeof body?.mode === "string" ? body.mode.toUpperCase() : "DRY_RUN";
      if (!VALID_MODES.has(rawMode)) {
        return c.json(
          { data: null, error: { code: "VALIDATION_ERROR", message: "mode must be ENFORCING, DRY_RUN, or DISABLED" } },
          400,
        );
      }
      const description = typeof body?.description === "string" ? body.description.trim() || null : null;

      const policy = await prisma.policy.create({
        data: {
          organizationId,
          name,
          description,
          enabled: body?.enabled === false ? false : true,
          mode: normalizePolicyMode(rawMode),
        },
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
        return c.json({ data: null, error: { code: "VALIDATION_ERROR", message: "policyId is required" } }, 400);
      }
      const body = await c.req.json().catch(() => null);

      const existing = await prisma.policy.findFirst({ where: { id: policyId, organizationId } });
      if (!existing) {
        return c.json({ data: null, error: { code: "NOT_FOUND", message: "Policy not found" } }, 404);
      }

      const data: { name?: string; description?: string | null; enabled?: boolean; mode?: "ENFORCING" | "DRY_RUN" | "DISABLED" } = {};
      if (typeof body?.name === "string" && body.name.trim()) data.name = body.name.trim();
      if (typeof body?.description === "string") data.description = body.description.trim() || null;
      if (typeof body?.enabled === "boolean") data.enabled = body.enabled;
      if (typeof body?.mode === "string") {
        const nextMode = body.mode.toUpperCase();
        if (!VALID_MODES.has(nextMode)) {
          return c.json(
            { data: null, error: { code: "VALIDATION_ERROR", message: "mode must be ENFORCING, DRY_RUN, or DISABLED" } },
            400,
          );
        }
        data.mode = normalizePolicyMode(nextMode);
      }

      const policy = await prisma.policy.update({ where: { id: policyId }, data });

      await recordAuditEvent({
        organizationId,
        eventType: "POLICY_UPDATED",
        actorId: userId,
        metadata: { policyId, changes: data },
      });

      return c.json({ data: policy, error: null });
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
        return c.json({ data: null, error: { code: "VALIDATION_ERROR", message: "policyId is required" } }, 400);
      }

      const existing = await prisma.policy.findFirst({ where: { id: policyId, organizationId } });
      if (!existing) {
        return c.json({ data: null, error: { code: "NOT_FOUND", message: "Policy not found" } }, 404);
      }

      // PolicyRule rows cascade-delete via the FK's onDelete: Cascade.
      await prisma.policy.delete({ where: { id: policyId } });

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
        return c.json({ data: null, error: { code: "VALIDATION_ERROR", message: "policyId is required" } }, 400);
      }
      const body = await c.req.json().catch(() => null);

      const policy = await prisma.policy.findFirst({ where: { id: policyId, organizationId } });
      if (!policy) {
        return c.json({ data: null, error: { code: "NOT_FOUND", message: "Policy not found" } }, 404);
      }

      const name = typeof body?.name === "string" ? body.name.trim() : "";
      const actionInput = typeof body?.action === "string" ? body.action : "";
      if (!name || !VALID_ACTIONS.has(actionInput)) {
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

      const sensitiveAreas = stringArray(body?.sensitiveAreas, VALID_SENSITIVE_AREAS);
      const repositoryCriticalityIn = stringArray(body?.repositoryCriticalityIn, VALID_CRITICALITY);
      const requiredApprovals = stringArray(body?.requiredApprovals).filter((a) => a.trim().length > 0);
      const aiInvolved = typeof body?.aiInvolved === "boolean" ? body.aiInvolved : undefined;
      const riskAtLeast =
        typeof body?.riskAtLeast === "number" && Number.isFinite(body.riskAtLeast)
          ? Math.max(0, Math.min(100, Math.round(body.riskAtLeast)))
          : undefined;
      const reason = typeof body?.reason === "string" ? body.reason.trim() || undefined : undefined;
      const precedence = typeof body?.precedence === "number" ? Math.round(body.precedence) : 0;

      const rule = await prisma.policyRule.create({
        data: {
          organizationId,
          policyId,
          name,
          aiInvolved,
          sensitiveAreas,
          riskAtLeast,
          repositoryCriticalityIn,
          action,
          requiredApprovals,
          reason,
          precedence,
        },
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
          { data: null, error: { code: "VALIDATION_ERROR", message: "policyId and ruleId are required" } },
          400,
        );
      }
      const body = await c.req.json().catch(() => null);

      const existing = await prisma.policyRule.findFirst({ where: { id: ruleId, policyId, organizationId } });
      if (!existing) {
        return c.json({ data: null, error: { code: "NOT_FOUND", message: "Policy rule not found" } }, 404);
      }

      const name = typeof body?.name === "string" ? body.name.trim() : "";
      const actionInput = typeof body?.action === "string" ? body.action : "";
      if (!name || !VALID_ACTIONS.has(actionInput)) {
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

      const sensitiveAreas = stringArray(body?.sensitiveAreas, VALID_SENSITIVE_AREAS);
      const repositoryCriticalityIn = stringArray(body?.repositoryCriticalityIn, VALID_CRITICALITY);
      const requiredApprovals = stringArray(body?.requiredApprovals).filter((a) => a.trim().length > 0);
      const aiInvolved = typeof body?.aiInvolved === "boolean" ? body.aiInvolved : null;
      const riskAtLeast =
        typeof body?.riskAtLeast === "number" && Number.isFinite(body.riskAtLeast)
          ? Math.max(0, Math.min(100, Math.round(body.riskAtLeast)))
          : null;
      const reason = typeof body?.reason === "string" ? body.reason.trim() || null : null;
      const precedence = typeof body?.precedence === "number" ? Math.round(body.precedence) : existing.precedence;

      const rule = await prisma.policyRule.update({
        where: { id: ruleId },
        data: {
          name,
          aiInvolved,
          sensitiveAreas,
          riskAtLeast,
          repositoryCriticalityIn,
          action,
          requiredApprovals,
          reason,
          precedence,
        },
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
        return c.json({ data: null, error: { code: "VALIDATION_ERROR", message: "ruleId is required" } }, 400);
      }

      const existing = await prisma.policyRule.findFirst({ where: { id: ruleId, organizationId } });
      if (!existing) {
        return c.json({ data: null, error: { code: "NOT_FOUND", message: "Policy rule not found" } }, 404);
      }

      await prisma.policyRule.delete({ where: { id: ruleId } });

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