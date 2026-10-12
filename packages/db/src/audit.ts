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

import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
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
  "ORGANIZATION_DATA_EXPORTED",
  "ORGANIZATION_RETENTION_UPDATED",
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

type AuditEventIntegrityInput = {
  organizationId?: string | null;
  eventType: string;
  actorId?: string | null;
  metadata?: Record<string, unknown>;
  createdAt?: string | Date | null;
  previousHash?: string | null;
};

export type AuditEventForVerification = {
  id: string;
  organizationId: string | null;
  eventType: string;
  actorId: string | null;
  createdAt: Date;
  metadata: unknown;
};

export type AuditChainVerificationResult = {
  valid: boolean;
  checkedEvents: number;
  invalidEventId?: string;
  reason?: "MISSING_METADATA" | "MISSING_INTEGRITY_HASH" | "CHAIN_MISMATCH" | "HASH_MISMATCH";
};

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeJson(entry));
  }

  if (value && typeof value === "object") {
    const sortedEntries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );

    return Object.fromEntries(sortedEntries.map(([key, entry]) => [key, canonicalizeJson(entry)]));
  }

  return value;
}

export function computeAuditEventIntegrityHash(params: AuditEventIntegrityInput): string {
  const normalized = canonicalizeJson({
    organizationId: params.organizationId ?? null,
    eventType: params.eventType,
    actorId: params.actorId ?? null,
    metadata: params.metadata ?? {},
    createdAt: params.createdAt
      ? new Date(params.createdAt).toISOString()
      : new Date().toISOString(),
    previousHash: params.previousHash ?? null,
  });

  return createHash("sha256")
    .update(`${JSON.stringify(normalized)}|audit-v1`)
    .digest("hex");
}

export function verifyAuditEventChain(
  events: AuditEventForVerification[],
): AuditChainVerificationResult {
  const eventsByParent = new Map<string, AuditEventForVerification[]>();
  const verifiedHashes = new Map<string, string>();
  const seenHashes = new Set<string>();
  const chainOrganizationId = events[0]?.organizationId;
  for (const [index, event] of events.entries()) {
    if (event.organizationId !== chainOrganizationId) {
      return {
        valid: false,
        checkedEvents: index,
        invalidEventId: event.id,
        reason: "CHAIN_MISMATCH",
      };
    }
    if (!event.metadata || typeof event.metadata !== "object" || Array.isArray(event.metadata)) {
      return {
        valid: false,
        checkedEvents: index,
        invalidEventId: event.id,
        reason: "MISSING_METADATA",
      };
    }

    const metadata = event.metadata as Record<string, unknown>;
    const integrityHash = metadata["integrityHash"];
    if (typeof integrityHash !== "string") {
      return {
        valid: false,
        checkedEvents: index,
        invalidEventId: event.id,
        reason: "MISSING_INTEGRITY_HASH",
      };
    }
    const storedPreviousHash = metadata["previousHash"] ?? null;
    if (storedPreviousHash !== null && typeof storedPreviousHash !== "string") {
      return {
        valid: false,
        checkedEvents: index,
        invalidEventId: event.id,
        reason: "CHAIN_MISMATCH",
      };
    }

    const baseMetadata = { ...metadata };
    delete baseMetadata["integrityHash"];
    delete baseMetadata["previousHash"];
    const expectedHash = computeAuditEventIntegrityHash({
      organizationId: event.organizationId,
      eventType: event.eventType,
      actorId: event.actorId,
      metadata: baseMetadata,
      createdAt: event.createdAt,
      previousHash: storedPreviousHash,
    });
    if (integrityHash !== expectedHash) {
      return {
        valid: false,
        checkedEvents: index,
        invalidEventId: event.id,
        reason: "HASH_MISMATCH",
      };
    }

    if (seenHashes.has(integrityHash)) {
      return {
        valid: false,
        checkedEvents: index,
        invalidEventId: event.id,
        reason: "CHAIN_MISMATCH",
      };
    }
    seenHashes.add(integrityHash);
    verifiedHashes.set(event.id, integrityHash);
    const siblings = eventsByParent.get(storedPreviousHash ?? "") ?? [];
    siblings.push(event);
    eventsByParent.set(storedPreviousHash ?? "", siblings);
  }

  if (events.length === 0) {
    return { valid: true, checkedEvents: 0 };
  }

  const roots = eventsByParent.get("");
  if (!roots || roots.length !== 1) {
    return {
      valid: false,
      checkedEvents: 0,
      invalidEventId: (roots?.[1] ?? events[0])?.id,
      reason: "CHAIN_MISMATCH",
    };
  }

  const root = roots[0];
  if (!root) {
    return { valid: false, checkedEvents: 0, reason: "CHAIN_MISMATCH" };
  }
  let current: AuditEventForVerification | undefined = root;
  const visited = new Set<string>();
  while (current) {
    if (visited.has(current.id)) {
      return {
        valid: false,
        checkedEvents: visited.size,
        invalidEventId: current.id,
        reason: "CHAIN_MISMATCH",
      };
    }
    visited.add(current.id);
    const currentHash = verifiedHashes.get(current.id);
    if (!currentHash) {
      return {
        valid: false,
        checkedEvents: visited.size - 1,
        invalidEventId: current.id,
        reason: "MISSING_INTEGRITY_HASH",
      };
    }
    const successors = eventsByParent.get(currentHash);
    if (successors && successors.length > 1) {
      return {
        valid: false,
        checkedEvents: visited.size,
        invalidEventId: successors[1]?.id,
        reason: "CHAIN_MISMATCH",
      };
    }
    current = successors?.[0];
  }

  if (visited.size !== events.length) {
    return {
      valid: false,
      checkedEvents: visited.size,
      invalidEventId: events.find((event) => !visited.has(event.id))?.id,
      reason: "CHAIN_MISMATCH",
    };
  }

  return { valid: true, checkedEvents: events.length };
}

async function readPreviousAuditEvent(
  transaction: Prisma.TransactionClient,
  organizationId?: string | null,
): Promise<{ integrityHash: string | null; createdAt: Date | null }> {
  const latestEvent = await transaction.auditEvent.findFirst({
    where: organizationId ? { organizationId } : { organizationId: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { metadata: true, createdAt: true },
  });

  const metadata = latestEvent?.metadata as { integrityHash?: string } | null;
  return {
    integrityHash: metadata?.integrityHash ?? null,
    createdAt: latestEvent?.createdAt ?? null,
  };
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
    await prisma.$transaction(async (transaction) => {
      const chainKey = `ai-sdlc-audit:${params.organizationId ?? "global"}`;
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${chainKey}))`;

      const previousEvent = await readPreviousAuditEvent(
        transaction,
        params.organizationId ?? null,
      );
      const previousHash = previousEvent.integrityHash;
      const createdAt = new Date(
        Math.max(Date.now(), (previousEvent.createdAt?.getTime() ?? 0) + 1),
      );
      const baseMetadata = { ...(params.metadata ?? {}) };
      const integrityHash = computeAuditEventIntegrityHash({
        organizationId: params.organizationId ?? null,
        eventType: params.eventType,
        actorId: params.actorId ?? null,
        metadata: baseMetadata,
        createdAt,
        previousHash,
      });

      await transaction.auditEvent.create({
        data: {
          organizationId: params.organizationId ?? undefined,
          actorId: params.actorId ?? undefined,
          eventType: params.eventType,
          createdAt,
          metadata: {
            ...baseMetadata,
            previousHash,
            integrityHash,
          },
        },
      });
    });
  } catch (error) {
    console.error(
      `[audit] failed to record ${params.eventType}${params.organizationId ? ` for org ${params.organizationId}` : ""}:`,
      error,
    );
  }
}
