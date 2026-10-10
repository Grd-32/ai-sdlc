/**
 * Centralized resource-aware authorization (Milestone A).
 *
 * Complements role-based middleware with explicit resource + action checks.
 * HTTP routes should still use requireOrganizationRole for the membership gate;
 * call authorize() when an action depends on resource type (e.g. policy write).
 */

import type { OrganizationRole } from "@prisma/client";

export type ResourceType =
  | "organization"
  | "member"
  | "repository"
  | "pull_request"
  | "policy"
  | "evidence"
  | "audit_event"
  | "identity_provider"
  | "scim_token"
  | "domain";

export type AuthorizeAction = "read" | "write" | "manage" | "delete" | "approve";

/** Effective role priority — SECURITY is a legacy alias for SECURITY_ADMIN. */
export const ROLE_PRIORITY: Record<OrganizationRole, number> = {
  OWNER: 9,
  ADMIN: 8,
  SECURITY: 7,
  SECURITY_ADMIN: 7,
  SECURITY_ANALYST: 6,
  ENGINEER: 5,
  REVIEWER: 4,
  AUDITOR: 3,
  VIEWER: 2,
};

/** Normalize legacy SECURITY role to SECURITY_ADMIN for comparisons. */
export function normalizeRole(role: OrganizationRole): OrganizationRole {
  return role === "SECURITY" ? "SECURITY_ADMIN" : role;
}

export function roleAtLeast(role: OrganizationRole, minimum: OrganizationRole): boolean {
  return ROLE_PRIORITY[normalizeRole(role)] >= ROLE_PRIORITY[normalizeRole(minimum)];
}

export function canManageRole(actorRole: OrganizationRole, targetRole: OrganizationRole): boolean {
  return roleAtLeast(actorRole, targetRole);
}

type PermissionRule = {
  resource: ResourceType;
  action: AuthorizeAction;
  minimumRole: OrganizationRole;
};

/**
 * Static permission matrix. Extend as ABAC rules are added.
 * manage > write > read for escalation purposes in callers.
 */
const PERMISSIONS: PermissionRule[] = [
  { resource: "organization", action: "read", minimumRole: "VIEWER" },
  { resource: "organization", action: "manage", minimumRole: "ADMIN" },
  { resource: "organization", action: "delete", minimumRole: "OWNER" },

  { resource: "member", action: "read", minimumRole: "VIEWER" },
  { resource: "member", action: "write", minimumRole: "ADMIN" },
  { resource: "member", action: "manage", minimumRole: "ADMIN" },

  { resource: "repository", action: "read", minimumRole: "VIEWER" },
  { resource: "repository", action: "write", minimumRole: "ENGINEER" },
  { resource: "repository", action: "manage", minimumRole: "ADMIN" },

  { resource: "pull_request", action: "read", minimumRole: "VIEWER" },
  { resource: "pull_request", action: "approve", minimumRole: "REVIEWER" },

  { resource: "policy", action: "read", minimumRole: "VIEWER" },
  { resource: "policy", action: "write", minimumRole: "SECURITY_ADMIN" },
  { resource: "policy", action: "manage", minimumRole: "SECURITY_ADMIN" },
  { resource: "policy", action: "delete", minimumRole: "ADMIN" },

  { resource: "evidence", action: "read", minimumRole: "VIEWER" },
  { resource: "evidence", action: "write", minimumRole: "ENGINEER" },

  { resource: "audit_event", action: "read", minimumRole: "AUDITOR" },
  { resource: "audit_event", action: "manage", minimumRole: "ADMIN" },

  { resource: "identity_provider", action: "read", minimumRole: "ADMIN" },
  { resource: "identity_provider", action: "manage", minimumRole: "ADMIN" },

  { resource: "scim_token", action: "manage", minimumRole: "ADMIN" },

  { resource: "domain", action: "read", minimumRole: "ADMIN" },
  { resource: "domain", action: "manage", minimumRole: "ADMIN" },
];

export interface AuthorizeParams {
  role: OrganizationRole;
  resource: ResourceType;
  action: AuthorizeAction;
}

export interface AuthorizeResult {
  allowed: boolean;
  reason?: string;
}

export function authorize(params: AuthorizeParams): AuthorizeResult {
  const rule = PERMISSIONS.find(
    (r) => r.resource === params.resource && r.action === params.action,
  );
  if (!rule) {
    return { allowed: false, reason: `No permission rule for ${params.resource}:${params.action}` };
  }

  if (!roleAtLeast(params.role, rule.minimumRole)) {
    return {
      allowed: false,
      reason: `Role ${params.role} below minimum ${rule.minimumRole} for ${params.resource}:${params.action}`,
    };
  }

  return { allowed: true };
}
