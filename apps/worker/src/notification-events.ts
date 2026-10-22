import { prisma, type OrganizationRole } from "@ai-sdlc/db";
import { enqueueNotificationDelivery } from "./queue.js";

export async function notifyOrganizationRoles(input: {
  organizationId: string;
  roles: OrganizationRole[];
  userIds?: string[];
  type: string;
  title: string;
  body: string;
  href?: string;
  dedupeKey: string;
}): Promise<void> {
  const members = await prisma.organizationMember.findMany({
    where: {
      organizationId: input.organizationId,
      ...(input.userIds?.length
        ? { OR: [{ role: { in: input.roles } }, { userId: { in: input.userIds } }] }
        : { role: { in: input.roles } }),
      scimActive: true,
      user: { active: true },
    },
    select: { userId: true },
  });
  for (const member of members) {
    const notification = await prisma.notification.upsert({
      where: {
        userId_dedupeKey: {
          userId: member.userId,
          dedupeKey: `${input.dedupeKey}:${member.userId}`,
        },
      },
      create: {
        organizationId: input.organizationId,
        userId: member.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        ...(input.href ? { href: input.href } : {}),
        dedupeKey: `${input.dedupeKey}:${member.userId}`,
      },
      update: {},
      select: { id: true, emailStatus: true },
    });
    if (notification.emailStatus !== "PENDING") continue;
    try {
      await enqueueNotificationDelivery(notification.id);
    } catch (error) {
      console.error("[notifications] worker event enqueue failed", {
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
      await prisma.notification.update({
        where: { id: notification.id },
        data: { emailStatus: "FAILED" },
      });
    }
  }
}
