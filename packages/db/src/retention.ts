export interface RetentionCleanupParams<TPrisma> {
  prisma: TPrisma;
  maxAgeDays?: number;
  now?: Date;
}

export type OrganizationRetentionOverride = {
  organizationId: string;
  maxAgeDays: number;
};

export function buildRetentionCutoff(maxAgeDays: number, now = new Date()): Date {
  if (!Number.isFinite(maxAgeDays) || maxAgeDays < 0) {
    throw new Error("maxAgeDays must be a non-negative number");
  }

  const cutoff = new Date(now.getTime());
  cutoff.setUTCDate(cutoff.getUTCDate() - maxAgeDays);
  return cutoff;
}

export async function pruneExpiredSessions<
  TPrisma extends {
    session: {
      deleteMany: (args: {
        where: {
          OR: Array<{ expiresAt: { lt: Date } } | { revokedAt: { not: null; lt: Date } }>;
        };
      }) => Promise<{ count: number }>;
    };
  },
>({ prisma, maxAgeDays = 30, now = new Date() }: RetentionCleanupParams<TPrisma>): Promise<number> {
  const cutoff = buildRetentionCutoff(maxAgeDays, now);

  const result = await prisma.session.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { not: null, lt: cutoff } }],
    },
  });

  return result.count;
}

export async function pruneExpiredWebhookEvents<
  TPrisma extends {
    gitHubWebhookEvent: {
      deleteMany: (args: {
        where: {
          createdAt?: { lt: Date };
          status?: { in: string[] };
          organizationId?: string | null | { in?: string[]; notIn?: string[] };
          OR?: Array<{
            createdAt: { lt: Date };
            status: { in: string[] };
            organizationId?: string | null | { in?: string[]; notIn?: string[] };
          }>;
        };
      }) => Promise<{ count: number }>;
    };
  },
>({
  prisma,
  maxAgeDays = 90,
  now = new Date(),
  organizationOverrides = [],
}: RetentionCleanupParams<TPrisma> & {
  organizationOverrides?: OrganizationRetentionOverride[];
}): Promise<number> {
  const status = { in: ["COMPLETED", "FAILED", "DLQ"] };

  if (organizationOverrides.length === 0) {
    const cutoff = buildRetentionCutoff(maxAgeDays, now);
    const result = await prisma.gitHubWebhookEvent.deleteMany({
      where: { createdAt: { lt: cutoff }, status },
    });
    return result.count;
  }

  const overridesByAge = new Map<number, string[]>();
  for (const override of organizationOverrides) {
    if (!override.organizationId)
      throw new Error("organizationId is required for retention override");
    if (
      !Number.isSafeInteger(override.maxAgeDays) ||
      override.maxAgeDays < 1 ||
      override.maxAgeDays > 3650
    ) {
      throw new Error("retention override maxAgeDays must be an integer between 1 and 3650");
    }
    const organizationIds = overridesByAge.get(override.maxAgeDays) ?? [];
    organizationIds.push(override.organizationId);
    overridesByAge.set(override.maxAgeDays, organizationIds);
  }

  const overriddenOrganizationIds = organizationOverrides.map(
    ({ organizationId }) => organizationId,
  );
  const filters = [
    {
      organizationId: null,
      createdAt: { lt: buildRetentionCutoff(maxAgeDays, now) },
      status,
    },
    {
      organizationId: { notIn: overriddenOrganizationIds },
      createdAt: { lt: buildRetentionCutoff(maxAgeDays, now) },
      status,
    },
    ...[...overridesByAge].map(([retentionDays, organizationIds]) => ({
      organizationId: { in: organizationIds },
      createdAt: { lt: buildRetentionCutoff(retentionDays, now) },
      status,
    })),
  ];

  const result = await prisma.gitHubWebhookEvent.deleteMany({ where: { OR: filters } });
  return result.count;
}
