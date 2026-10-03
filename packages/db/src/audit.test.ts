import { describe, it, expect, afterAll } from "vitest";

process.env["DATABASE_URL"] =
  process.env["DATABASE_URL"] ?? "postgresql://ai_sdlc:ai_sdlc_dev@localhost:5432/ai_sdlc?schema=public";

const { prisma, recordAuditEvent } = await import("./index.js");

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