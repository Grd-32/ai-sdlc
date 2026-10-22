import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "./index.js";

let organizationId: string | undefined;

afterAll(async () => {
  if (organizationId) {
    await prisma.organization.delete({ where: { id: organizationId } });
  }
});

describe("policy revision immutability", () => {
  it("blocks direct mutation and deletion while permitting lifecycle cascades", async () => {
    const organization = await prisma.organization.create({
      data: { name: "Policy Revision Immutability", slug: `policy-revision-${Date.now()}` },
    });
    organizationId = organization.id;

    const policy = await prisma.policy.create({
      data: {
        organizationId,
        name: "Immutable policy",
        version: "v1",
      },
    });
    const revision = await prisma.policyRevision.create({
      data: {
        organizationId,
        policyId: policy.id,
        version: policy.version,
        snapshot: { name: policy.name },
      },
    });

    await expect(
      prisma.policyRevision.update({
        where: { id: revision.id },
        data: { snapshot: { name: "Tampered" } },
      }),
    ).rejects.toThrow("PolicyRevision records are append-only");
    await expect(prisma.policyRevision.delete({ where: { id: revision.id } })).rejects.toThrow(
      "PolicyRevision records are append-only",
    );
    await expect(prisma.$executeRaw`TRUNCATE TABLE "PolicyRevision"`).rejects.toThrow(
      "PolicyRevision records are append-only",
    );

    await prisma.policy.delete({ where: { id: policy.id } });
    const retainedRevision = await prisma.policyRevision.findUnique({
      where: { id: revision.id },
    });
    expect(retainedRevision).toMatchObject({
      id: revision.id,
      policyId: null,
      snapshot: { name: policy.name },
    });

    await prisma.organization.delete({ where: { id: organization.id } });
    organizationId = undefined;
  });
});
