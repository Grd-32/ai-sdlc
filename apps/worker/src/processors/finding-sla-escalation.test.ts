import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  notifier: vi.fn(),
}));

vi.mock("@ai-sdlc/db", () => ({
  prisma: { securityFinding: { findMany: mocks.findMany } },
}));

vi.mock("../notification-events.js", () => ({
  notifyOrganizationRoles: mocks.notifier,
}));

const { processFindingSlaEscalation } = await import("./finding-sla-escalation.js");

describe("finding SLA escalation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMany.mockResolvedValue([
      {
        id: "finding-1",
        organizationId: "org-1",
        assigneeId: "assignee-1",
        severity: "HIGH",
        title: "Outdated dependency",
        dueAt: new Date("2026-10-16T00:00:00Z"),
      },
      {
        id: "finding-2",
        organizationId: "org-1",
        assigneeId: null,
        severity: "LOW",
        title: "Unsafe redirect",
        dueAt: new Date("2026-10-16T00:00:00Z"),
      },
    ]);
    mocks.notifier.mockResolvedValue(undefined);
  });

  it("notifies security admins and the assignee once per finding due date", async () => {
    await processFindingSlaEscalation();

    expect(mocks.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.notifier).toHaveBeenCalledTimes(2);
    expect(mocks.notifier).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        organizationId: "org-1",
        roles: ["OWNER", "ADMIN", "SECURITY"],
        userIds: ["assignee-1"],
        type: "FINDING_SLA_OVERDUE",
        dedupeKey: "finding-sla-overdue:finding-1:2026-10-16T00:00:00.000Z",
      }),
    );
    expect(mocks.notifier).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        roles: ["OWNER", "ADMIN", "SECURITY"],
        type: "FINDING_SLA_OVERDUE",
        dedupeKey: "finding-sla-overdue:finding-2:2026-10-16T00:00:00.000Z",
      }),
    );
  });
});
