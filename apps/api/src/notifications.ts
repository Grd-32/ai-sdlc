import { prisma } from "@ai-sdlc/db";
import { enqueueNotificationDelivery } from "./queue.js";

export async function createUserNotification(input: {
  organizationId: string;
  userId: string;
  invitationId?: string;
  type: string;
  title: string;
  body: string;
  href?: string;
  dedupeKey: string;
}) {
  const notification = await prisma.notification.upsert({
    where: {
      userId_dedupeKey: { userId: input.userId, dedupeKey: input.dedupeKey },
    },
    create: input,
    update: {},
  });

  if (notification.emailStatus === "PENDING") {
    try {
      await enqueueNotificationDelivery(notification.id);
    } catch (error) {
      console.error("[notifications] email delivery enqueue failed", {
        notificationId: notification.id,
        error,
      });
      await prisma.notificationDeliveryAttempt.upsert({
        where: { notificationId_attempt: { notificationId: notification.id, attempt: 0 } },
        create: {
          notificationId: notification.id,
          attempt: 0,
          status: "FAILED",
          completedAt: new Date(),
          latencyMs: 0,
          errorCode: "QUEUE_ENQUEUE_FAILED",
        },
        update: {
          status: "FAILED",
          completedAt: new Date(),
          latencyMs: 0,
          errorCode: "QUEUE_ENQUEUE_FAILED",
        },
      });
      return prisma.notification.update({
        where: { id: notification.id },
        data: { emailStatus: "FAILED" },
      });
    }
  }

  return notification;
}
