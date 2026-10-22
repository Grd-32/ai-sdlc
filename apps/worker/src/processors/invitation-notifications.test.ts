import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notificationFindUnique: vi.fn(),
  notificationUpdate: vi.fn(),
  deliveryAttemptUpsert: vi.fn(),
  deliveryAttemptUpdate: vi.fn(),
  organizationMemberFindFirst: vi.fn(),
  organizationInvitationCount: vi.fn(),
  notificationPreferenceFindUnique: vi.fn(),
}));

vi.mock("@ai-sdlc/db", () => ({
  prisma: {
    notification: {
      findUnique: mocks.notificationFindUnique,
      update: mocks.notificationUpdate,
    },
    notificationDeliveryAttempt: {
      upsert: mocks.deliveryAttemptUpsert,
      update: mocks.deliveryAttemptUpdate,
    },
    organizationMember: { findFirst: mocks.organizationMemberFindFirst },
    organizationInvitation: { count: mocks.organizationInvitationCount },
    notificationPreference: { findUnique: mocks.notificationPreferenceFindUnique },
  },
  getNotificationEmailPreferenceField: () => "accountEmailEnabled",
}));

import { processNotificationDelivery } from "./notifications.js";

const job = {
  data: { notificationId: "invitation-notification" },
  attemptsMade: 0,
  opts: { attempts: 5 },
} as import("bullmq").Job<{ notificationId: string; attemptOffset?: number }>;
const previousEmailEnvironment = {
  resendApiKey: process.env["RESEND_API_KEY"],
  emailFrom: process.env["EMAIL_FROM"],
  appUrl: process.env["APP_URL"],
};

describe("invitation notification delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.notificationFindUnique.mockResolvedValue({
      id: "invitation-notification",
      organizationId: "org-1",
      userId: "user-1",
      invitationId: "invitation-1",
      type: "ORGANIZATION_INVITATION_CREATED",
      title: "Invitation to Example",
      body: "Accept the invitation.",
      href: "/invitations/accept?token=secret",
      emailStatus: "PENDING",
      user: { email: "invitee@example.test", active: true },
    });
    mocks.notificationUpdate.mockResolvedValue({});
    mocks.deliveryAttemptUpsert.mockResolvedValue({ id: "attempt-1" });
    mocks.deliveryAttemptUpdate.mockResolvedValue({});
    mocks.organizationMemberFindFirst.mockResolvedValue(null);
    mocks.organizationInvitationCount.mockResolvedValue(1);
    mocks.notificationPreferenceFindUnique.mockResolvedValue({
      emailEnabled: true,
      accountEmailEnabled: true,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: "email-1" }),
      }),
    );
    process.env["RESEND_API_KEY"] = "test-resend-key";
    process.env["EMAIL_FROM"] = "test@example.test";
    process.env["APP_URL"] = "https://example.test";
  });

  afterEach(() => {
    if (previousEmailEnvironment.resendApiKey === undefined) {
      delete process.env["RESEND_API_KEY"];
    } else {
      process.env["RESEND_API_KEY"] = previousEmailEnvironment.resendApiKey;
    }
    if (previousEmailEnvironment.emailFrom === undefined) {
      delete process.env["EMAIL_FROM"];
    } else {
      process.env["EMAIL_FROM"] = previousEmailEnvironment.emailFrom;
    }
    if (previousEmailEnvironment.appUrl === undefined) {
      delete process.env["APP_URL"];
    } else {
      process.env["APP_URL"] = previousEmailEnvironment.appUrl;
    }
    vi.unstubAllGlobals();
  });

  it("sends a matching pending invitation without granting membership", async () => {
    await processNotificationDelivery(job);

    expect(mocks.organizationInvitationCount).toHaveBeenCalledTimes(1);
    expect(mocks.organizationMemberFindFirst).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mocks.notificationUpdate).toHaveBeenCalledWith({
      where: { id: "invitation-notification" },
      data: { emailStatus: "SENT" },
    });
  });

  it("does not send revoked, accepted, expired, or mismatched invitations", async () => {
    mocks.organizationInvitationCount.mockResolvedValue(0);

    await processNotificationDelivery(job);

    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.notificationUpdate).toHaveBeenCalledWith({
      where: { id: "invitation-notification" },
      data: { emailStatus: "SKIPPED" },
    });
  });
});
