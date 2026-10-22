import type { Job } from "bullmq";
import { getNotificationEmailPreferenceField, prisma } from "@ai-sdlc/db";

type EmailEnvironment = Record<string, string | undefined>;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}

export async function sendNotificationEmail(
  input: {
    email: string;
    title: string;
    body: string;
    href: string | null;
  },
  env: EmailEnvironment = process.env,
  fetcher: typeof fetch = fetch,
): Promise<"SENT" | "SKIPPED"> {
  const apiKey = env["RESEND_API_KEY"];
  if (!apiKey) return "SKIPPED";
  const from = env["EMAIL_FROM"];
  if (!from) throw new Error("EMAIL_FROM is required when RESEND_API_KEY is configured");

  const appUrl = env["APP_URL"] ?? "http://localhost:3000";
  const actionUrl = input.href ? new URL(input.href, appUrl).toString() : null;
  const text = [input.title, input.body, ...(actionUrl ? [actionUrl] : [])].join("\n\n");
  const html = [
    `<h1>${escapeHtml(input.title)}</h1>`,
    `<p>${escapeHtml(input.body)}</p>`,
    ...(actionUrl ? [`<p><a href="${escapeHtml(actionUrl)}">Open Nomalog</a></p>`] : []),
  ].join("");

  const response = await fetcher("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [input.email], subject: input.title, text, html }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Email provider returned HTTP ${response.status}`);
  }
  return "SENT";
}

export async function processNotificationDelivery(
  job: Job<{ notificationId: string; attemptOffset?: number }>,
): Promise<void> {
  const notification = await prisma.notification.findUnique({
    where: { id: job.data.notificationId },
    include: { user: { select: { email: true, active: true } } },
  });
  if (!notification) return;
  if (notification.emailStatus === "SENT" || notification.emailStatus === "SKIPPED") return;

  const attemptNumber = (job.data.attemptOffset ?? 0) + job.attemptsMade + 1;
  const attemptedAt = new Date();
  const attempt = await prisma.notificationDeliveryAttempt.upsert({
    where: {
      notificationId_attempt: { notificationId: notification.id, attempt: attemptNumber },
    },
    create: {
      notificationId: notification.id,
      attempt: attemptNumber,
      status: "PROCESSING",
      attemptedAt,
    },
    update: {
      status: "PROCESSING",
      attemptedAt,
      completedAt: null,
      latencyMs: null,
      errorCode: null,
    },
  });

  const completeAttempt = async (status: string, errorCode?: string): Promise<void> => {
    await prisma.notificationDeliveryAttempt.update({
      where: { id: attempt.id },
      data: {
        status,
        completedAt: new Date(),
        latencyMs: Date.now() - attemptedAt.getTime(),
        ...(errorCode ? { errorCode } : {}),
      },
    });
  };
  const markSkipped = async (): Promise<void> => {
    await prisma.notification.update({
      where: { id: notification.id },
      data: { emailStatus: "SKIPPED" },
    });
    await completeAttempt("SKIPPED");
  };

  try {
    if (!notification.user.active) {
      await markSkipped();
      return;
    }

    const membership = await prisma.organizationMember.findFirst({
      where: {
        organizationId: notification.organizationId,
        userId: notification.userId,
        scimActive: true,
        user: { active: true },
      },
      select: { id: true },
    });
    const hasPendingInvitation =
      typeof notification.invitationId === "string" &&
      notification.invitationId.length > 0 &&
      (await prisma.organizationInvitation.count({
        where: {
          id: notification.invitationId,
          organizationId: notification.organizationId,
          email: notification.user.email,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      })) > 0;
    if (typeof notification.invitationId === "string" ? !hasPendingInvitation : !membership) {
      await markSkipped();
      return;
    }

    const preference = await prisma.notificationPreference.findUnique({
      where: {
        organizationId_userId: {
          organizationId: notification.organizationId,
          userId: notification.userId,
        },
      },
      select: {
        emailEnabled: true,
        securityEmailEnabled: true,
        assessmentsEmailEnabled: true,
        governanceEmailEnabled: true,
        integrationsEmailEnabled: true,
        accountEmailEnabled: true,
      },
    });
    const categoryPreference = getNotificationEmailPreferenceField(notification.type);
    if (
      preference?.emailEnabled === false ||
      (categoryPreference !== null && preference?.[categoryPreference] === false)
    ) {
      await markSkipped();
      return;
    }

    const status = await sendNotificationEmail({
      email: notification.user.email,
      title: notification.title,
      body: notification.body,
      href: notification.href,
    });
    await prisma.notification.update({
      where: { id: notification.id },
      data: { emailStatus: status },
    });
    await completeAttempt(status);
  } catch (error) {
    const maximumAttempts = job.opts.attempts ?? 1;
    const finalAttempt = attemptNumber >= maximumAttempts;
    await completeAttempt("FAILED", "PROVIDER_OR_DELIVERY_ERROR");
    if (finalAttempt) {
      await prisma.notification.update({
        where: { id: notification.id },
        data: { emailStatus: "FAILED" },
      });
    }
    throw error;
  }
}
