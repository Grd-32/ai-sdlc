import { describe, expect, it, vi } from "vitest";
import { processRetentionCleanup } from "./retention.js";

describe("processRetentionCleanup", () => {
  it("prunes expired sessions and finalized webhook events using configured ages", async () => {
    const sessionDeleteMany = vi.fn().mockResolvedValue({ count: 2 });
    const webhookDeleteMany = vi.fn().mockResolvedValue({ count: 3 });
    const organizationFindMany = vi.fn().mockResolvedValue([
      { id: "org-short", webhookRetentionDays: 14 },
      { id: "org-global", webhookRetentionDays: null },
    ]);
    const prismaClient = {
      session: { deleteMany: sessionDeleteMany },
      gitHubWebhookEvent: { deleteMany: webhookDeleteMany },
      organization: { findMany: organizationFindMany },
    };
    const now = new Date("2026-10-07T12:00:00.000Z");

    const result = await processRetentionCleanup(prismaClient as unknown as typeof import("@ai-sdlc/db").prisma, {
      sessionMaxAgeDays: 30,
      webhookMaxAgeDays: 90,
    }, now);

    expect(result).toEqual({ sessionsDeleted: 2, webhookEventsDeleted: 3 });
    expect(organizationFindMany).toHaveBeenCalledWith({
      where: { webhookRetentionDays: { not: null } },
      select: { id: true, webhookRetentionDays: true },
    });
    expect(sessionDeleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { expiresAt: { lt: new Date("2026-09-07T12:00:00.000Z") } },
          { revokedAt: { not: null, lt: new Date("2026-09-07T12:00:00.000Z") } },
        ],
      },
    });
    expect(webhookDeleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          {
            organizationId: null,
            createdAt: { lt: new Date("2026-07-09T12:00:00.000Z") },
            status: { in: ["COMPLETED", "FAILED", "DLQ"] },
          },
          {
            organizationId: { notIn: ["org-short"] },
            createdAt: { lt: new Date("2026-07-09T12:00:00.000Z") },
            status: { in: ["COMPLETED", "FAILED", "DLQ"] },
          },
          {
            organizationId: { in: ["org-short"] },
            createdAt: { lt: new Date("2026-09-23T12:00:00.000Z") },
            status: { in: ["COMPLETED", "FAILED", "DLQ"] },
          },
        ],
      },
    });
  });
});