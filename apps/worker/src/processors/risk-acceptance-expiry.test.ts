import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env["DATABASE_URL"] =
  process.env["DATABASE_URL"] ??
  "postgresql://ai_sdlc:ai_sdlc_dev@localhost:5432/ai_sdlc?schema=public";
const { prisma } = await import("@ai-sdlc/db");
const { processRiskAcceptanceExpiry } = await import("./risk-acceptance-expiry.js");

const runId = Date.now().toString(36);
let organizationId: string;
let userId: string;
let findingId: string;
let riskAcceptanceId: string;

beforeAll(async () => {
  const organization = await prisma.organization.create({
    data: { name: `Risk expiry test ${runId}`, slug: `risk-expiry-${runId}` },
  });
  organizationId = organization.id;
  const user = await prisma.user.create({
    data: { email: `risk-expiry-${runId}@example.test`, name: "Risk Expiry Test" },
  });
  userId = user.id;
  await prisma.organizationMember.create({
    data: { organizationId, userId, role: "OWNER" },
  });
  const finding = await prisma.securityFinding.create({
    data: {
      organizationId,
      provider: "test",
      title: `Expired acceptance finding ${runId}`,
      severity: "HIGH",
      status: "ACCEPTED",
    },
  });
  findingId = finding.id;
  const acceptance = await prisma.riskAcceptance.create({
    data: {
      organizationId,
      findingId,
      acceptedBy: userId,
      reason: "Temporary acceptance for test",
      status: "ACCEPTED",
      expiresAt: new Date(Date.now() - 60_000),
    },
  });
  riskAcceptanceId = acceptance.id;
});

afterAll(async () => {
  if (organizationId) {
    await prisma.organization.delete({ where: { id: organizationId } });
  }
  if (userId) {
    await prisma.user.delete({ where: { id: userId } });
  }
});

describe("risk acceptance expiry processing", () => {
  it("expires the acceptance, reopens the finding, and notifies security owners", async () => {
    const notifier = vi.fn().mockResolvedValue(undefined);
    await processRiskAcceptanceExpiry(notifier);

    const acceptance = await prisma.riskAcceptance.findUnique({
      where: { id: riskAcceptanceId },
      select: { status: true },
    });
    const finding = await prisma.securityFinding.findUnique({
      where: { id: findingId },
      select: { status: true, resolvedAt: true },
    });
    const activity = await prisma.findingActivity.findFirst({
      where: { findingId, type: "RISK_ACCEPTANCE_EXPIRED" },
    });

    expect(acceptance?.status).toBe("EXPIRED");
    expect(finding).toEqual({ status: "OPEN", resolvedAt: null });
    expect(activity?.toStatus).toBe("OPEN");
    expect(notifier).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId,
        roles: ["OWNER", "ADMIN", "SECURITY"],
        type: "RISK_ACCEPTANCE_EXPIRED",
        dedupeKey: `risk-acceptance-expired:${riskAcceptanceId}`,
      }),
    );
  });

  it("does not emit a second expiry notification after the acceptance is expired", async () => {
    const notifier = vi.fn().mockResolvedValue(undefined);
    await processRiskAcceptanceExpiry(notifier);
    expect(notifier).not.toHaveBeenCalled();
  });

  it("warns once when an acceptance is approaching expiry", async () => {
    const approaching = await prisma.riskAcceptance.create({
      data: {
        organizationId,
        findingId,
        acceptedBy: userId,
        reason: "Near-expiry warning test",
        status: "ACCEPTED",
        expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      },
      select: { id: true },
    });
    const notifier = vi.fn().mockResolvedValue(undefined);

    await processRiskAcceptanceExpiry(notifier);

    const acceptance = await prisma.riskAcceptance.findUnique({
      where: { id: approaching.id },
      select: { status: true, expiryWarningNotifiedAt: true },
    });
    expect(acceptance?.status).toBe("ACCEPTED");
    expect(acceptance?.expiryWarningNotifiedAt).toBeInstanceOf(Date);
    expect(notifier).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId,
        type: "RISK_ACCEPTANCE_EXPIRING",
        dedupeKey: `risk-acceptance-expiring:${approaching.id}`,
      }),
    );

    const retryNotifier = vi.fn().mockResolvedValue(undefined);
    await processRiskAcceptanceExpiry(retryNotifier);
    expect(retryNotifier).not.toHaveBeenCalledWith(
      expect.objectContaining({ dedupeKey: `risk-acceptance-expiring:${approaching.id}` }),
    );
  });

  it("returns an accepted component to review when its last risk acceptance expires", async () => {
    const component = await prisma.sBOMComponent.create({
      data: {
        organizationId,
        name: `test-component-${runId}`,
        version: "1.0.0",
        status: "ACCEPTED",
      },
      select: { id: true },
    });
    const acceptance = await prisma.riskAcceptance.create({
      data: {
        organizationId,
        componentId: component.id,
        acceptedBy: userId,
        reason: "Temporary component risk acceptance",
        status: "ACCEPTED",
        expiresAt: new Date(Date.now() - 60_000),
      },
      select: { id: true },
    });
    const notifier = vi.fn().mockResolvedValue(undefined);

    await processRiskAcceptanceExpiry(notifier);

    const updatedComponent = await prisma.sBOMComponent.findUnique({
      where: { id: component.id },
      select: { status: true },
    });
    const expiredAcceptance = await prisma.riskAcceptance.findUnique({
      where: { id: acceptance.id },
      select: { status: true },
    });
    expect(updatedComponent?.status).toBe("REVIEW");
    expect(expiredAcceptance?.status).toBe("EXPIRED");
    expect(notifier).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "RISK_ACCEPTANCE_EXPIRED",
        dedupeKey: `risk-acceptance-expired:${acceptance.id}`,
      }),
    );
  });

  it("keeps a component accepted while another unexpired acceptance remains active", async () => {
    const component = await prisma.sBOMComponent.create({
      data: {
        organizationId,
        name: `shared-component-${runId}`,
        version: "2.0.0",
        status: "ACCEPTED",
      },
      select: { id: true },
    });
    await prisma.riskAcceptance.createMany({
      data: [
        {
          organizationId,
          componentId: component.id,
          acceptedBy: userId,
          reason: "Expiring component acceptance",
          status: "ACCEPTED",
          expiresAt: new Date(Date.now() - 60_000),
        },
        {
          organizationId,
          componentId: component.id,
          acceptedBy: userId,
          reason: "Remaining active component acceptance",
          status: "ACCEPTED",
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      ],
    });

    await processRiskAcceptanceExpiry(vi.fn().mockResolvedValue(undefined));

    const updatedComponent = await prisma.sBOMComponent.findUnique({
      where: { id: component.id },
      select: { status: true },
    });
    expect(updatedComponent?.status).toBe("ACCEPTED");
  });
});
