import { describe, expect, it, vi } from "vitest";

vi.mock("./index.js", () => ({ prisma: {} }));

import {
  computeAuditEventIntegrityHash,
  verifyAuditEventChain,
  type AuditEventForVerification,
} from "./audit.js";

function createChain(): AuditEventForVerification[] {
  const first = {
    id: "event-1",
    organizationId: "org-1",
    eventType: "POLICY_CREATED",
    actorId: "user-1",
    createdAt: new Date("2026-10-09T10:00:00.000Z"),
    metadata: { policyId: "policy-1", action: "create" } as Record<string, unknown>,
  };
  const firstHash = computeAuditEventIntegrityHash({
    ...first,
    metadata: first.metadata,
    previousHash: null,
  });
  first.metadata = { ...first.metadata, previousHash: null, integrityHash: firstHash };

  const second = {
    id: "event-2",
    organizationId: "org-1",
    eventType: "POLICY_UPDATED",
    actorId: "user-1",
    createdAt: new Date("2026-10-09T10:01:00.000Z"),
    metadata: { policyId: "policy-1", mode: "ENFORCING" } as Record<string, unknown>,
  };
  const secondHash = computeAuditEventIntegrityHash({
    ...second,
    metadata: second.metadata,
    previousHash: firstHash,
  });
  second.metadata = {
    ...second.metadata,
    previousHash: firstHash,
    integrityHash: secondHash,
  };

  return [first, second];
}

function eventAt(events: AuditEventForVerification[], index: number): AuditEventForVerification {
  const event = events[index];
  if (!event) {
    throw new Error(`Expected audit event at index ${index}`);
  }
  return event;
}

describe("audit event integrity verification", () => {
  it("validates a complete chain regardless of input order", () => {
    expect(verifyAuditEventChain(createChain().reverse())).toEqual({
      valid: true,
      checkedEvents: 2,
    });
  });

  it("detects event metadata tampering", () => {
    const events = createChain();
    const first = eventAt(events, 0);
    first.metadata = {
      ...(first.metadata as Record<string, unknown>),
      action: "delete",
    };

    expect(verifyAuditEventChain(events)).toMatchObject({
      valid: false,
      checkedEvents: 0,
      invalidEventId: "event-1",
      reason: "HASH_MISMATCH",
    });
  });

  it("detects a broken link between otherwise present events", () => {
    const events = createChain();
    const second = eventAt(events, 1);
    const baseMetadata = { policyId: "policy-1", mode: "ENFORCING" };
    const previousHash = "unexpected-parent";
    second.metadata = {
      ...baseMetadata,
      previousHash,
      integrityHash: computeAuditEventIntegrityHash({
        organizationId: second.organizationId,
        eventType: second.eventType,
        actorId: second.actorId,
        metadata: baseMetadata,
        createdAt: second.createdAt,
        previousHash,
      }),
    };

    expect(verifyAuditEventChain(events)).toMatchObject({
      valid: false,
      checkedEvents: 1,
      invalidEventId: "event-2",
      reason: "CHAIN_MISMATCH",
    });
  });

  it("detects missing integrity metadata", () => {
    const events = createChain();
    eventAt(events, 0).metadata = { action: "create" };

    expect(verifyAuditEventChain(events)).toMatchObject({
      valid: false,
      checkedEvents: 0,
      invalidEventId: "event-1",
      reason: "MISSING_INTEGRITY_HASH",
    });
  });

  it("detects multiple events branching from the same previous hash", () => {
    const events = createChain();
    const original = eventAt(events, 1);
    const baseMetadata = { policyId: "policy-1", action: "delete" };
    const branch: AuditEventForVerification = {
      ...original,
      id: "event-branch",
      eventType: "POLICY_DELETED",
      createdAt: new Date("2026-10-09T10:02:00.000Z"),
      metadata: {
        ...baseMetadata,
        previousHash: null,
        integrityHash: computeAuditEventIntegrityHash({
          organizationId: original.organizationId,
          eventType: "POLICY_DELETED",
          actorId: original.actorId,
          metadata: baseMetadata,
          createdAt: new Date("2026-10-09T10:02:00.000Z"),
          previousHash: null,
        }),
      },
    };

    expect(verifyAuditEventChain([...events, branch])).toMatchObject({
      valid: false,
      checkedEvents: 0,
      reason: "CHAIN_MISMATCH",
    });
  });

  it("rejects mixed-organization events as a single chain", () => {
    const events = createChain();
    eventAt(events, 1).organizationId = "org-2";

    expect(verifyAuditEventChain(events)).toMatchObject({
      valid: false,
      checkedEvents: 1,
      invalidEventId: "event-2",
      reason: "CHAIN_MISMATCH",
    });
  });
});
