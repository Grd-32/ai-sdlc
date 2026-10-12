import {
  prisma,
  pruneExpiredSessions,
  pruneExpiredWebhookEvents,
} from "@ai-sdlc/db";

export type RetentionCleanupPolicy = {
  sessionMaxAgeDays: number;
  webhookMaxAgeDays: number;
};

export async function processRetentionCleanup(
  prismaClient: typeof prisma,
  policy: RetentionCleanupPolicy,
  now = new Date(),
): Promise<{ sessionsDeleted: number; webhookEventsDeleted: number }> {
  const [sessionsDeleted, organizationsWithOverrides] = await Promise.all([
    pruneExpiredSessions({
      prisma: prismaClient,
      maxAgeDays: policy.sessionMaxAgeDays,
      now,
    }),
    prismaClient.organization.findMany({
      where: { webhookRetentionDays: { not: null } },
      select: { id: true, webhookRetentionDays: true },
    }),
  ]);
  const webhookEventsDeleted = await pruneExpiredWebhookEvents({
    prisma: prismaClient,
    maxAgeDays: policy.webhookMaxAgeDays,
    now,
    organizationOverrides: organizationsWithOverrides.flatMap((organization) =>
      organization.webhookRetentionDays === null
        ? []
        : [{ organizationId: organization.id, maxAgeDays: organization.webhookRetentionDays }],
    ),
  });

  console.log(
    `[retention] sessionsDeleted=${sessionsDeleted} webhookEventsDeleted=${webhookEventsDeleted}`,
  );

  return { sessionsDeleted, webhookEventsDeleted };
}