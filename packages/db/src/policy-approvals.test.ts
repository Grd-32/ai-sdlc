import { afterAll, describe, expect, it } from "vitest";
import { getPolicyEnforcementApprovalStatuses, prisma } from "./index.js";

let organizationId: string | undefined;
const userIds: string[] = [];

afterAll(async () => {
  if (organizationId) {
    await prisma.organization.delete({ where: { id: organizationId } });
  }
  if (userIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
});

describe("policy enforcement approval quorum", () => {
  it("counts only current-revision approvals from active owners and administrators", async () => {
    const organization = await prisma.organization.create({
      data: {
        name: "Policy Approval Quorum",
        slug: `policy-approval-quorum-${Date.now()}`,
        policyApprovalQuorum: 2,
      },
    });
    organizationId = organization.id;

    const users = await Promise.all(
      ["author", "admin-one", "admin-two", "viewer"].map((suffix) =>
        prisma.user.create({
          data: {
            email: `policy-approval-${suffix}-${Date.now()}@example.test`,
            active: suffix !== "admin-two",
          },
        }),
      ),
    );
    userIds.push(...users.map((user) => user.id));
    const [author, adminOne, adminTwo, viewer] = users;
    if (!author || !adminOne || !adminTwo || !viewer) {
      throw new Error("Failed to create test users for policy approval quorum.");
    }

    await prisma.organizationMember.createMany({
      data: [
        { organizationId, userId: author.id, role: "OWNER" },
        { organizationId, userId: adminOne.id, role: "ADMIN" },
        { organizationId, userId: adminTwo.id, role: "ADMIN", scimActive: false },
        { organizationId, userId: viewer.id, role: "VIEWER" },
      ],
    });
    const policy = await prisma.policy.create({
      data: { organizationId, name: "Production gate", mode: "ENFORCING", version: "v2" },
    });
    await prisma.policyRevision.create({
      data: {
        organizationId,
        policyId: policy.id,
        version: "v2",
        actorId: author.id,
        snapshot: { mode: "ENFORCING" },
      },
    });
    await prisma.policyApproval.createMany({
      data: [
        { organizationId, policyId: policy.id, version: "v2", actorId: author.id },
        { organizationId, policyId: policy.id, version: "v2", actorId: adminOne.id },
        { organizationId, policyId: policy.id, version: "v1", actorId: adminTwo.id },
        { organizationId, policyId: policy.id, version: "v2", actorId: viewer.id },
      ],
    });

    const currentStatus = async () => {
      const statuses = await getPolicyEnforcementApprovalStatuses({
        prisma,
        organizationId: organization.id,
        policies: [policy],
      });
      const status = statuses.get(policy.id);
      if (!status) {
        throw new Error("Missing policy approval status in test.");
      }
      return status;
    };

    expect(await currentStatus()).toMatchObject({
      requiredApprovals: 2,
      approvalCount: 1,
      approved: false,
      revisionAuthorId: author.id,
      approverIds: [adminOne.id],
    });

    await prisma.organizationMember.update({
      where: { organizationId_userId: { organizationId, userId: adminTwo.id } },
      data: { scimActive: true },
    });
    await prisma.policyApproval.create({
      data: { organizationId, policyId: policy.id, version: "v2", actorId: adminTwo.id },
    });
    expect(await currentStatus()).toMatchObject({
      approvalCount: 1,
      approved: false,
    });

    await prisma.user.update({ where: { id: adminTwo.id }, data: { active: true } });
    expect(await currentStatus()).toMatchObject({
      approvalCount: 2,
      approved: true,
    });

    await prisma.organizationMember.update({
      where: { organizationId_userId: { organizationId, userId: adminOne.id } },
      data: { role: "ENGINEER" },
    });
    expect(await currentStatus()).toMatchObject({
      approvalCount: 1,
      approved: false,
    });

    await prisma.organization.delete({ where: { id: organization.id } });
    organizationId = undefined;
  });
});
