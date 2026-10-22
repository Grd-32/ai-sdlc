import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  organizationMemberFindMany: vi.fn(),
  notificationUpsert: vi.fn(),
  notificationAttemptUpsert: vi.fn(),
  notificationUpdate: vi.fn(),
  enqueueNotificationDelivery: vi.fn(),
}));

vi.mock("@ai-sdlc/db", () => ({
  prisma: {
    organizationMember: { findMany: mocks.organizationMemberFindMany },
    notification: { upsert: mocks.notificationUpsert, update: mocks.notificationUpdate },
    notificationDeliveryAttempt: { upsert: mocks.notificationAttemptUpsert },
  },
}));

vi.mock("./queue.js", () => ({
  enqueueNotificationDelivery: mocks.enqueueNotificationDelivery,
}));

const { notifyOrganizationRoles } = await import("./notification-events.js");

describe("notifyOrganizationRoles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.organizationMemberFindMany.mockResolvedValue([
      { userId: "security-user" },
      { userId: "assignee" },
    ]);
    mocks.notificationUpsert.mockResolvedValue({ id: "notification-id", emailStatus: "SKIPPED" });
  });

  it("includes explicit users alongside role recipients and scopes deduplication per user", async () => {
    await notifyOrganizationRoles({
      organizationId: "org-1",
      roles: ["OWNER", "ADMIN", "SECURITY"],
      userIds: ["assignee"],
      type: "FINDING_SLA_OVERDUE",
      title: "Finding remediation is overdue",
      body: "A finding passed its due date.",
      dedupeKey: "finding-sla-overdue:finding-1:2026-10-16T00:00:00.000Z",
    });

    expect(mocks.organizationMemberFindMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        OR: [{ role: { in: ["OWNER", "ADMIN", "SECURITY"] } }, { userId: { in: ["assignee"] } }],
        scimActive: true,
        user: { active: true },
      },
      select: { userId: true },
    });
    expect(mocks.notificationUpsert).toHaveBeenCalledTimes(2);
    expect(mocks.notificationUpsert).toHaveBeenNthCalledWith(1, {
      where: {
        userId_dedupeKey: {
          userId: "security-user",
          dedupeKey: "finding-sla-overdue:finding-1:2026-10-16T00:00:00.000Z:security-user",
        },
      },
      create: {
        organizationId: "org-1",
        userId: "security-user",
        type: "FINDING_SLA_OVERDUE",
        title: "Finding remediation is overdue",
        body: "A finding passed its due date.",
        dedupeKey: "finding-sla-overdue:finding-1:2026-10-16T00:00:00.000Z:security-user",
      },
      update: {},
      select: { id: true, emailStatus: true },
    });
    expect(mocks.enqueueNotificationDelivery).not.toHaveBeenCalled();
  });
});
