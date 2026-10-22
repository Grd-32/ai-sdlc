import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { processNotificationDelivery, sendNotificationEmail } from "./notifications.js";

const prismaMocks = vi.hoisted(() => ({
  notificationFindUnique: vi.fn(),
  notificationUpdate: vi.fn(),
  deliveryAttemptUpsert: vi.fn(),
  deliveryAttemptUpdate: vi.fn(),
  organizationMemberFindFirst: vi.fn(),
  notificationPreferenceFindUnique: vi.fn(),
}));

vi.mock("@ai-sdlc/db", () => ({
  prisma: {
    notification: {
      findUnique: prismaMocks.notificationFindUnique,
      update: prismaMocks.notificationUpdate,
    },
    notificationDeliveryAttempt: {
      upsert: prismaMocks.deliveryAttemptUpsert,
      update: prismaMocks.deliveryAttemptUpdate,
    },
    organizationMember: { findFirst: prismaMocks.organizationMemberFindFirst },
    notificationPreference: { findUnique: prismaMocks.notificationPreferenceFindUnique },
  },
  getNotificationEmailPreferenceField: (type: string) =>
    type.startsWith("FINDING_") ? "securityEmailEnabled" : null,
}));

function isEmailPayload(value: unknown): value is { html: string; to: string[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    "html" in value &&
    typeof value.html === "string" &&
    "to" in value &&
    Array.isArray(value.to) &&
    value.to.every((recipient) => typeof recipient === "string")
  );
}

describe("sendNotificationEmail", () => {
  it("keeps notifications in-app when email is not configured", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const result = await sendNotificationEmail(
      {
        email: "reviewer@example.com",
        title: "Review requested",
        body: "Check this change",
        href: null,
      },
      {},
      fetcher,
    );

    expect(result).toBe("SKIPPED");
    expect(fetcher).not.toHaveBeenCalled();
  });

  describe("processNotificationDelivery category preferences", () => {
    beforeEach(() => {
      prismaMocks.notificationFindUnique.mockResolvedValue({
        id: "notification-1",
        organizationId: "org-1",
        userId: "user-1",
        type: "FINDING_HIGH",
        title: "Finding detected",
        body: "A high severity finding was detected.",
        href: null,
        emailStatus: "PENDING",
        user: { email: "user@example.com", active: true },
      });
      prismaMocks.deliveryAttemptUpsert.mockResolvedValue({ id: "attempt-1" });
      prismaMocks.deliveryAttemptUpdate.mockResolvedValue({});
      prismaMocks.notificationUpdate.mockResolvedValue({});
      prismaMocks.organizationMemberFindFirst.mockResolvedValue({ id: "member-1" });
      prismaMocks.notificationPreferenceFindUnique.mockResolvedValue({
        emailEnabled: true,
        securityEmailEnabled: false,
        assessmentsEmailEnabled: true,
        governanceEmailEnabled: true,
        integrationsEmailEnabled: true,
        accountEmailEnabled: true,
      });
      vi.stubGlobal("fetch", vi.fn());
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("records email as skipped when the recipient disables that notification category", async () => {
      const job = {
        data: { notificationId: "notification-1" },
        attemptsMade: 0,
        opts: { attempts: 5 },
      } as import("bullmq").Job<{ notificationId: string; attemptOffset?: number }>;

      await processNotificationDelivery(job);

      expect(prismaMocks.notificationUpdate).toHaveBeenCalledWith({
        where: { id: "notification-1" },
        data: { emailStatus: "SKIPPED" },
      });
      expect(prismaMocks.deliveryAttemptUpdate).toHaveBeenCalledTimes(1);
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  it("sends escaped content through the configured Resend API", async () => {
    let requestBody: string | undefined;
    const fetcher = vi.fn<typeof fetch>((_input, options) => {
      if (typeof options?.body === "string") requestBody = options.body;
      return Promise.resolve(new Response(null, { status: 202 }));
    });
    const result = await sendNotificationEmail(
      {
        email: "reviewer@example.com",
        title: "<Review>",
        body: "A & B",
        href: "/dashboard/changes/1",
      },
      {
        RESEND_API_KEY: "test-key",
        EMAIL_FROM: "Nomalog <notifications@example.com>",
        APP_URL: "https://nomalog.example",
      },
      fetcher,
    );

    expect(result).toBe("SENT");
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer test-key",
          "Content-Type": "application/json",
        },
      }),
    );
    const parsedPayload = JSON.parse(requestBody ?? "{}") as unknown;
    expect(isEmailPayload(parsedPayload)).toBe(true);
    if (!isEmailPayload(parsedPayload)) throw new Error("Resend request payload is malformed");
    const payload = parsedPayload;
    expect(payload.to).toEqual(["reviewer@example.com"]);
    expect(payload.html).toContain("&lt;Review&gt;");
    expect(payload.html).toContain("A &amp; B");
    expect(payload.html).toContain("https://nomalog.example/dashboard/changes/1");
  });

  it("surfaces provider configuration and delivery errors", async () => {
    await expect(
      sendNotificationEmail(
        { email: "reviewer@example.com", title: "Review", body: "Review this", href: null },
        { RESEND_API_KEY: "test-key" },
      ),
    ).rejects.toThrow("EMAIL_FROM is required");

    await expect(
      sendNotificationEmail(
        { email: "reviewer@example.com", title: "Review", body: "Review this", href: null },
        { RESEND_API_KEY: "test-key", EMAIL_FROM: "Nomalog <notifications@example.com>" },
        vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 })),
      ),
    ).rejects.toThrow("Email provider returned HTTP 503");
  });
});
