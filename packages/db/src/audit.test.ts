import { describe, it, expect, afterAll } from "vitest";

process.env["DATABASE_URL"] =
  process.env["DATABASE_URL"] ??
  "postgresql://ai_sdlc:ai_sdlc_dev@localhost:5432/ai_sdlc?schema=public";

const { prisma, recordAuditEvent, computeAuditEventIntegrityHash, verifyAuditEventChain } =
  await import("./index.js");

const runId = Date.now().toString(36);
const createdEventIds: string[] = [];

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { id: { in: createdEventIds } } });
});

describe("@ai-sdlc/db audit", () => {
  it("records an event with no organization (e.g. USER_LOGIN)", async () => {
    await recordAuditEvent({
      eventType: "USER_LOGIN",
      metadata: { test: `no-org-${runId}` },
    });

    const event = await prisma.auditEvent.findFirst({
      where: { eventType: "USER_LOGIN", metadata: { path: ["test"], equals: `no-org-${runId}` } },
    });

    expect(event).not.toBeNull();
    expect(event?.organizationId).toBeNull();
    if (event) createdEventIds.push(event.id);
  });

  it("records an org-scoped event with metadata", async () => {
    const organization = await prisma.organization.create({
      data: { name: `Audit Test Org ${runId}`, slug: `audit-test-org-${runId}` },
    });

    await recordAuditEvent({
      organizationId: organization.id,
      eventType: "POLICY_EVALUATED",
      metadata: { action: "BLOCK", test: runId },
    });

    const event = await prisma.auditEvent.findFirst({
      where: { organizationId: organization.id, eventType: "POLICY_EVALUATED" },
    });

    expect(event).not.toBeNull();
    expect(event?.organizationId).toBe(organization.id);
    expect((event?.metadata as { action?: string } | null)?.action).toBe("BLOCK");
    if (event) createdEventIds.push(event.id);

    await prisma.organization.delete({ where: { id: organization.id } });
  });

  it("computes a consistent integrity hash across the event payload", () => {
    const hash = computeAuditEventIntegrityHash({
      organizationId: "org_123",
      eventType: "POLICY_EVALUATED",
      actorId: "user_456",
      metadata: { action: "BLOCK", test: "abc" },
      createdAt: "2026-10-07T00:00:00.000Z",
      previousHash: "prev-hash",
    });

    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(32);
    expect(hash).not.toBe("prev-hash");
  });

  it("chains audit hashes from the previous event when available", async () => {
    const organization = await prisma.organization.create({
      data: { name: `Audit Chain Org ${runId}`, slug: `audit-chain-org-${runId}` },
    });

    await recordAuditEvent({
      organizationId: organization.id,
      eventType: "ORGANIZATION_CREATED",
      metadata: { decision: "bootstrap" },
    });

    await recordAuditEvent({
      organizationId: organization.id,
      eventType: "MEMBER_ADDED",
      metadata: { decision: "invite" },
    });

    const firstEvent = await prisma.auditEvent.findFirst({
      where: { organizationId: organization.id, eventType: "ORGANIZATION_CREATED" },
      orderBy: { createdAt: "asc" },
    });
    const secondEvent = await prisma.auditEvent.findFirst({
      where: { organizationId: organization.id, eventType: "MEMBER_ADDED" },
      orderBy: { createdAt: "asc" },
    });

    expect(firstEvent).not.toBeNull();
    expect(secondEvent).not.toBeNull();
    expect((firstEvent?.metadata as { integrityHash?: string } | null)?.integrityHash).toBeTruthy();
    expect((secondEvent?.metadata as { previousHash?: string } | null)?.previousHash).toBe(
      (firstEvent?.metadata as { integrityHash?: string } | null)?.integrityHash,
    );

    await prisma.organization.delete({ where: { id: organization.id } });
  });

  it("serializes concurrent audit writes into one verifiable chain", async () => {
    const organization = await prisma.organization.create({
      data: { name: `Concurrent Audit Org ${runId}`, slug: `concurrent-audit-org-${runId}` },
    });

    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        recordAuditEvent({
          organizationId: organization.id,
          eventType: "POLICY_UPDATED",
          metadata: { concurrentEvent: index },
        }),
      ),
    );

    const events = await prisma.auditEvent.findMany({
      where: { organizationId: organization.id, eventType: "POLICY_UPDATED" },
      select: {
        id: true,
        organizationId: true,
        eventType: true,
        actorId: true,
        createdAt: true,
        metadata: true,
      },
    });
    createdEventIds.push(...events.map((event) => event.id));

    expect(verifyAuditEventChain(events)).toEqual({ valid: true, checkedEvents: 8 });
    await prisma.organization.delete({ where: { id: organization.id } });
  });

  it("never throws, even if given a malformed organizationId", async () => {
    // recordAuditEvent must not let an audit-logging failure propagate and
    // block the security-sensitive operation it's describing.
    await expect(
      recordAuditEvent({
        organizationId: "not-a-real-org-id",
        eventType: "CHANGE_BLOCKED",
      }),
    ).resolves.toBeUndefined();
  });
});
