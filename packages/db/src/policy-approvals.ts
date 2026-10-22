import type { PrismaClient } from "@prisma/client";

export type PolicyApprovalTarget = {
  id: string;
  version: string;
};

export type PolicyEnforcementApprovalStatus = {
  requiredApprovals: number;
  approvalCount: number;
  approved: boolean;
  revisionAuthorId: string | null;
  approverIds: string[];
};

export async function getPolicyEnforcementApprovalStatuses({
  prisma,
  organizationId,
  policies,
}: {
  prisma: PrismaClient;
  organizationId: string;
  policies: readonly PolicyApprovalTarget[];
}): Promise<Map<string, PolicyEnforcementApprovalStatus>> {
  const statuses = new Map<string, PolicyEnforcementApprovalStatus>();
  if (policies.length === 0) {
    return statuses;
  }

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { policyApprovalQuorum: true },
  });
  if (!organization) {
    throw new Error(
      `Cannot read policy approval settings for missing organization ${organizationId}.`,
    );
  }

  const policyIds = [...new Set(policies.map((policy) => policy.id))];
  const versions = [...new Set(policies.map((policy) => policy.version))];
  const [revisions, approvals] = await Promise.all([
    prisma.policyRevision.findMany({
      where: {
        organizationId,
        policyId: { in: policyIds },
        version: { in: versions },
      },
      select: { policyId: true, version: true, actorId: true },
    }),
    prisma.policyApproval.findMany({
      where: {
        organizationId,
        policyId: { in: policyIds },
        version: { in: versions },
      },
      select: {
        policyId: true,
        version: true,
        actorId: true,
        actor: {
          select: {
            active: true,
            memberships: {
              where: {
                organizationId,
                scimActive: true,
                role: { in: ["OWNER", "ADMIN"] },
              },
              select: { id: true },
            },
          },
        },
      },
    }),
  ]);

  for (const policy of policies) {
    const revisionAuthorId =
      revisions.find(
        (revision) => revision.policyId === policy.id && revision.version === policy.version,
      )?.actorId ?? null;
    const approverIds = [
      ...new Set(
        approvals
          .filter(
            (approval) =>
              approval.policyId === policy.id &&
              approval.version === policy.version &&
              approval.actor.active &&
              approval.actor.memberships.length > 0 &&
              approval.actorId !== revisionAuthorId,
          )
          .map((approval) => approval.actorId),
      ),
    ];
    statuses.set(policy.id, {
      requiredApprovals: organization.policyApprovalQuorum,
      approvalCount: approverIds.length,
      approved: approverIds.length >= organization.policyApprovalQuorum,
      revisionAuthorId,
      approverIds,
    });
  }

  return statuses;
}
