import { prisma, recordAuditEvent } from "@ai-sdlc/db";
import { notifyOrganizationRoles } from "../notification-events.js";

export async function processRiskAcceptanceExpiry(
  notifier: typeof notifyOrganizationRoles = notifyOrganizationRoles,
): Promise<void> {
  const now = new Date();
  const warningCutoff = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const approachingExpiry = await prisma.riskAcceptance.findMany({
    where: {
      status: "ACCEPTED",
      expiredNotifiedAt: null,
      expiryWarningNotifiedAt: null,
      expiresAt: { gt: now, lte: warningCutoff },
    },
    select: {
      id: true,
      organizationId: true,
      findingId: true,
      expiresAt: true,
      finding: { select: { title: true } },
      component: { select: { name: true } },
    },
    orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
    take: 500,
  });

  for (const acceptance of approachingExpiry) {
    await notifier({
      organizationId: acceptance.organizationId,
      roles: ["OWNER", "ADMIN", "SECURITY"],
      type: "RISK_ACCEPTANCE_EXPIRING",
      title: "Risk acceptance expiring soon",
      body: acceptance.finding
        ? `Risk acceptance for “${acceptance.finding.title}” expires within seven days. Review or renew it before expiry.`
        : acceptance.component
          ? `Risk acceptance for “${acceptance.component.name}” expires within seven days. Review or renew it before expiry.`
          : "A risk acceptance expires within seven days. Review or renew it before expiry.",
      ...(acceptance.findingId ? { href: "/dashboard/findings?status=ACCEPTED" } : {}),
      dedupeKey: `risk-acceptance-expiring:${acceptance.id}`,
    });
    await prisma.riskAcceptance.updateMany({
      where: {
        id: acceptance.id,
        status: "ACCEPTED",
        expiryWarningNotifiedAt: null,
        expiresAt: { gt: now, lte: warningCutoff },
      },
      data: { expiryWarningNotifiedAt: new Date() },
    });
  }

  const expired = await prisma.riskAcceptance.findMany({
    where: {
      expiresAt: { lte: now },
      OR: [{ status: "ACCEPTED" }, { status: "EXPIRED", expiredNotifiedAt: null }],
    },
    select: {
      id: true,
      organizationId: true,
      findingId: true,
      acceptedBy: true,
      status: true,
      finding: { select: { id: true, title: true, status: true, assigneeId: true } },
      component: { select: { id: true, name: true, status: true } },
    },
    orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
    take: 500,
  });

  for (const acceptance of expired) {
    const expiration = await prisma.$transaction(async (tx) => {
      const changed = await tx.riskAcceptance.updateMany({
        where: { id: acceptance.id, status: "ACCEPTED", expiresAt: { lte: now } },
        data: { status: "EXPIRED" },
      });
      if (changed.count !== 1 && acceptance.status !== "EXPIRED") {
        return { expired: false, findingReopened: false, componentReturnedToReview: false };
      }

      let findingReopened = false;
      let componentReturnedToReview = false;
      if (changed.count === 1 && acceptance.finding?.status === "ACCEPTED") {
        const reopened = await tx.securityFinding.updateMany({
          where: {
            id: acceptance.finding.id,
            organizationId: acceptance.organizationId,
            status: "ACCEPTED",
          },
          data: { status: "OPEN", resolvedAt: null, resolutionVerification: "NOT_VERIFIED" },
        });
        if (reopened.count === 1) {
          findingReopened = true;
          await tx.findingActivity.create({
            data: {
              organizationId: acceptance.organizationId,
              findingId: acceptance.finding.id,
              actorId: null,
              type: "RISK_ACCEPTANCE_EXPIRED",
              fromStatus: "ACCEPTED",
              toStatus: "OPEN",
              comment: "Finding reopened automatically because its risk acceptance expired.",
            },
          });
        }
      }
      if (changed.count === 1 && acceptance.component?.status === "ACCEPTED") {
        const otherActiveAcceptance = await tx.riskAcceptance.findFirst({
          where: {
            id: { not: acceptance.id },
            componentId: acceptance.component.id,
            status: "ACCEPTED",
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
          select: { id: true },
        });
        if (!otherActiveAcceptance) {
          const updated = await tx.sBOMComponent.updateMany({
            where: {
              id: acceptance.component.id,
              organizationId: acceptance.organizationId,
              status: "ACCEPTED",
            },
            data: { status: "REVIEW" },
          });
          componentReturnedToReview = updated.count === 1;
        }
      }
      return { expired: true, findingReopened, componentReturnedToReview };
    });
    if (!expiration.expired) continue;

    await recordAuditEvent({
      organizationId: acceptance.organizationId,
      actorId: null,
      eventType: "RISK_ACCEPTANCE_EXPIRED",
      metadata: {
        riskAcceptanceId: acceptance.id,
        findingId: acceptance.findingId,
        findingReopened: expiration.findingReopened,
        componentId: acceptance.component?.id ?? null,
        componentReturnedToReview: expiration.componentReturnedToReview,
      },
    });
    await notifier({
      organizationId: acceptance.organizationId,
      roles: ["OWNER", "ADMIN", "SECURITY"],
      type: "RISK_ACCEPTANCE_EXPIRED",
      title: "Risk acceptance expired",
      body: acceptance.finding
        ? `Risk acceptance expired for “${acceptance.finding.title}”. The finding is open for review.`
        : acceptance.component
          ? `Risk acceptance expired for “${acceptance.component.name}”. The component is marked for review.`
          : "A risk acceptance expired and no longer exempts the associated risk.",
      ...(acceptance.findingId
        ? { href: "/dashboard/findings?status=OPEN" }
        : acceptance.component
          ? { href: "/dashboard/components?status=REVIEW" }
          : {}),
      dedupeKey: `risk-acceptance-expired:${acceptance.id}`,
    });
    await prisma.riskAcceptance.updateMany({
      where: { id: acceptance.id, status: "EXPIRED", expiredNotifiedAt: null },
      data: { expiredNotifiedAt: new Date() },
    });
  }
}
