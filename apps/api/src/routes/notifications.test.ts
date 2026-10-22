import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../types.js";

const mocks = vi.hoisted(() => ({
  notificationFindFirst: vi.fn(),
  notificationAggregate: vi.fn(),
  notificationUpdateMany: vi.fn(),
  notificationPreferenceFindUnique: vi.fn(),
  notificationPreferenceUpsert: vi.fn(),
  deliveryAttemptUpsert: vi.fn(),
  enqueueNotificationDelivery: vi.fn(),
  recordAuditEvent: vi.fn(),
  getNotificationCategory: vi.fn(() => "OTHER"),
}));

vi.mock("@ai-sdlc/db", () => ({
  prisma: {
    notification: {
      findFirst: mocks.notificationFindFirst,
      updateMany: mocks.notificationUpdateMany,
    },
    notificationPreference: {
      findUnique: mocks.notificationPreferenceFindUnique,
      upsert: mocks.notificationPreferenceUpsert,
    },
    notificationDeliveryAttempt: {
      aggregate: mocks.notificationAggregate,
      upsert: mocks.deliveryAttemptUpsert,
    },
  },
  recordAuditEvent: mocks.recordAuditEvent,
  getNotificationCategory: mocks.getNotificationCategory,
  NOTIFICATION_EMAIL_PREFERENCE_FIELDS: {
    SECURITY: "securityEmailEnabled",
    ASSESSMENTS: "assessmentsEmailEnabled",
    GOVERNANCE: "governanceEmailEnabled",
    INTEGRATIONS: "integrationsEmailEnabled",
    ACCOUNT: "accountEmailEnabled",
  },
}));

vi.mock("../queue.js", () => ({
  enqueueNotificationDelivery: mocks.enqueueNotificationDelivery,
}));

vi.mock("../middleware/auth.js", () => ({
  requireAuth: async (
    c: { set: (key: string, value: string) => void },
    next: () => Promise<void>,
  ) => {
    c.set("userId", "admin-user");
    await next();
  },
  requireOrganizationRole:
    () => async (c: { set: (key: string, value: string) => void }, next: () => Promise<void>) => {
      c.set("organizationId", "org-1");
      await next();
    },
}));

const { registerNotificationRoutes } = await import("./notifications.js");

describe("notification delivery retry", () => {
  const app = new Hono<AppEnv>();
  registerNotificationRoutes(app);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.notificationFindFirst.mockResolvedValue({ id: "notification-1", emailStatus: "FAILED" });
    mocks.notificationAggregate.mockResolvedValue({ _max: { attempt: 5 } });
    mocks.notificationUpdateMany.mockResolvedValue({ count: 1 });
    mocks.deliveryAttemptUpsert.mockResolvedValue({});
    mocks.enqueueNotificationDelivery.mockResolvedValue("queued-job-1");
  });

  it("queues a failed delivery as a new global attempt and audits the action", async () => {
    const response = await app.request(
      "/api/organizations/org-1/notification-delivery-operations/notification-1/retry",
      { method: "POST" },
    );

    expect(response.status).toBe(202);
    expect(mocks.notificationFindFirst).toHaveBeenCalledWith({
      where: { id: "notification-1", organizationId: "org-1" },
      select: { id: true, emailStatus: true },
    });
    expect(mocks.notificationUpdateMany).toHaveBeenCalledWith({
      where: { id: "notification-1", organizationId: "org-1", emailStatus: "FAILED" },
      data: { emailStatus: "PENDING" },
    });
    expect(mocks.enqueueNotificationDelivery).toHaveBeenCalledWith("notification-1", 5);
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith({
      organizationId: "org-1",
      actorId: "admin-user",
      eventType: "NOTIFICATION_DELIVERY_RETRIED",
      metadata: { notificationId: "notification-1", attemptOffset: 5 },
    });
  });

  it("does not retry a notification that is not failed", async () => {
    mocks.notificationFindFirst.mockResolvedValue({
      id: "notification-1",
      emailStatus: "SENT",
    });

    const response = await app.request(
      "/api/organizations/org-1/notification-delivery-operations/notification-1/retry",
      { method: "POST" },
    );

    expect(response.status).toBe(409);
    expect(mocks.enqueueNotificationDelivery).not.toHaveBeenCalled();
  });

  it("does not expose notifications from another organization", async () => {
    mocks.notificationFindFirst.mockResolvedValue(null);

    const response = await app.request(
      "/api/organizations/org-1/notification-delivery-operations/foreign-notification/retry",
      { method: "POST" },
    );

    expect(response.status).toBe(404);
    expect(mocks.notificationFindFirst).toHaveBeenCalledWith({
      where: { id: "foreign-notification", organizationId: "org-1" },
      select: { id: true, emailStatus: true },
    });
    expect(mocks.notificationAggregate).not.toHaveBeenCalled();
    expect(mocks.enqueueNotificationDelivery).not.toHaveBeenCalled();
  });

  it("rejects a retry claimed by another administrator", async () => {
    mocks.notificationUpdateMany.mockResolvedValue({ count: 0 });

    const response = await app.request(
      "/api/organizations/org-1/notification-delivery-operations/notification-1/retry",
      { method: "POST" },
    );

    expect(response.status).toBe(409);
    expect(mocks.enqueueNotificationDelivery).not.toHaveBeenCalled();
  });

  it("restores failed status and records the queue failure when enqueue fails", async () => {
    mocks.enqueueNotificationDelivery.mockRejectedValue(new Error("Redis unavailable"));

    const response = await app.request(
      "/api/organizations/org-1/notification-delivery-operations/notification-1/retry",
      { method: "POST" },
    );

    expect(response.status).toBe(503);
    expect(mocks.notificationUpdateMany).toHaveBeenLastCalledWith({
      where: { id: "notification-1", organizationId: "org-1", emailStatus: "PENDING" },
      data: { emailStatus: "FAILED" },
    });
    expect(mocks.deliveryAttemptUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          notificationId_attempt: { notificationId: "notification-1", attempt: 6 },
        },
      }),
    );
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });

  it("returns enabled defaults and updates only valid notification preferences", async () => {
    mocks.notificationPreferenceFindUnique.mockResolvedValue(null);
    const getResponse = await app.request("/api/organizations/org-1/notification-preferences");
    expect(getResponse.status).toBe(200);
    expect(await getResponse.json()).toMatchObject({
      data: {
        emailEnabled: true,
        securityEmailEnabled: true,
        assessmentsEmailEnabled: true,
        governanceEmailEnabled: true,
        integrationsEmailEnabled: true,
        accountEmailEnabled: true,
      },
    });

    mocks.notificationPreferenceUpsert.mockResolvedValue({
      emailEnabled: true,
      securityEmailEnabled: false,
      assessmentsEmailEnabled: true,
      governanceEmailEnabled: true,
      integrationsEmailEnabled: true,
      accountEmailEnabled: true,
    });
    const patchResponse = await app.request("/api/organizations/org-1/notification-preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ securityEmailEnabled: false }),
    });
    expect(patchResponse.status).toBe(200);
    expect(mocks.notificationPreferenceUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId_userId: { organizationId: "org-1", userId: "admin-user" } },
        create: {
          organizationId: "org-1",
          userId: "admin-user",
          securityEmailEnabled: false,
        },
        update: { securityEmailEnabled: false },
      }),
    );
  });

  it("rejects empty, non-boolean, and unsupported notification preference updates", async () => {
    for (const body of [{}, { securityEmailEnabled: "false" }, { slackEnabled: true }]) {
      const response = await app.request("/api/organizations/org-1/notification-preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }
    expect(mocks.notificationPreferenceUpsert).not.toHaveBeenCalled();
  });
});
