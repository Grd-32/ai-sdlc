// /**
//  * Append-only audit event logging (README §23/§48/§92).
//  *
//  * This module only exposes a `create`-equivalent (recordAuditEvent) — no
//  * update or delete. Audit events must remain append-only.
//  */

// import { prisma } from "./index.js";

// export const AUDIT_EVENT_TYPES = [
//   "USER_LOGIN",
//   "GITHUB_INSTALLATION_CREATED",
//   "REPOSITORY_ENABLED",
//   "REPOSITORY_DISABLED",
//   "POLICY_CREATED",
//   "POLICY_UPDATED",
//   "POLICY_DELETED",
//   "POLICY_EVALUATED",
//   "CHANGE_BLOCKED",
//   "CHANGE_APPROVED",
//   "REVIEW_APPROVED",
//   "API_KEY_CREATED",
//   "API_KEY_REVOKED",
// ] as const;

// export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

// export interface RecordAuditEventParams {
//   /** Null for events not naturally scoped to one organization (e.g. USER_LOGIN). */
//   organizationId?: string | null;
//   eventType: AuditEventType;
//   actorId?: string | null;
//   metadata?: Record<string, unknown>;
// }

// /**
//  * Records an audit event.
//  *
//  * Deliberately does not throw on its own failure — a DB blip while writing
//  * an audit row must never block or roll back the security-sensitive
//  * operation it's describing (e.g. a login or a policy decision should still
//  * succeed even if the audit write itself fails). The failure is still never
//  * silent: it's logged loudly via console.error, consistent with README §24's
//  * "never silently convert failures into success" — that principle is about
//  * not hiding the failure, not about the audit log being able to veto the
//  * action it's recording.
//  */
// export async function recordAuditEvent(params: RecordAuditEventParams): Promise<void> {
//   try {
//     await prisma.auditEvent.create({
//       data: {
//         organizationId: params.organizationId ?? undefined,
//         actorId: params.actorId ?? undefined,
//         eventType: params.eventType,
//         // Prisma's generated InputJsonValue type doesn't directly accept a
//         // plain Record<string, unknown> (its `unknown` values are too wide).
//         // Cast through `unknown` — same pattern already used for Json fields
//         // elsewhere in this codebase (see analyze.ts's `factors`/`payload`
//         // fields) — rather than tightening this module's public param type
//         // to Prisma's internal JSON type, which callers shouldn't need to
//         // know about.
//         metadata: params.metadata as unknown as object | undefined,
//       },
//     });
//   } catch (error) {
//     console.error(
//       `[audit] failed to record ${params.eventType}${params.organizationId ? ` for org ${params.organizationId}` : ""}:`,
//       error,
//     );
//   }
// }
/**
 * Append-only audit event logging (README §23/§48/§92).
 *
 * This module only exposes a `create`-equivalent (recordAuditEvent) — no
 * update or delete. Audit events must remain append-only.
 */

import { prisma } from "./index.js";

export const AUDIT_EVENT_TYPES = [
  "USER_LOGIN",
  "GITHUB_INSTALLATION_CREATED",
  "GITHUB_INSTALLATION_REMOVED",
  "REPOSITORY_ENABLED",
  "REPOSITORY_DISABLED",
  "POLICY_CREATED",
  "POLICY_UPDATED",
  "POLICY_DELETED",
  "POLICY_EVALUATED",
  "CHANGE_BLOCKED",
  "CHANGE_APPROVED",
  "REVIEW_APPROVED",
  "API_KEY_CREATED",
  "API_KEY_REVOKED",
  // Milestone A — enterprise identity & onboarding
  "ORGANIZATION_CREATED",
  "MEMBER_ADDED",
  "MEMBER_REMOVED",
  "MEMBER_ROLE_UPDATED",
  "DOMAIN_REGISTERED",
  "IDENTITY_PROVIDER_CREATED",
  "IDENTITY_PROVIDER_UPDATED",
  "IDENTITY_PROVIDER_DELETED",
  "SSO_ENFORCEMENT_UPDATED",
  "SCIM_TOKEN_CREATED",
  "SCIM_USER_PROVISIONED",
  "SCIM_USER_DEACTIVATED",
  "SCIM_USER_REACTIVATED",
] as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

export interface RecordAuditEventParams {
  /** Null for events not naturally scoped to one organization (e.g. USER_LOGIN). */
  organizationId?: string | null;
  eventType: AuditEventType;
  actorId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Records an audit event.
 *
 * Deliberately does not throw on its own failure — a DB blip while writing
 * an audit row must never block or roll back the security-sensitive
 * operation it's describing (e.g. a login or a policy decision should still
 * succeed even if the audit write itself fails). The failure is still never
 * silent: it's logged loudly via console.error, consistent with README §24's
 * "never silently convert failures into success" — that principle is about
 * not hiding the failure, not about the audit log being able to veto the
 * action it's recording.
 */
export async function recordAuditEvent(params: RecordAuditEventParams): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        organizationId: params.organizationId ?? undefined,
        actorId: params.actorId ?? undefined,
        eventType: params.eventType,
        // Prisma's generated InputJsonValue type doesn't directly accept a
        // plain Record<string, unknown> (its `unknown` values are too wide).
        // Cast through `unknown` — same pattern already used for Json fields
        // elsewhere in this codebase (see analyze.ts's `factors`/`payload`
        // fields).
        metadata: params.metadata as unknown as object | undefined,
      },
    });
  } catch (error) {
    console.error(
      `[audit] failed to record ${params.eventType}${params.organizationId ? ` for org ${params.organizationId}` : ""}:`,
      error,
    );
  }
}