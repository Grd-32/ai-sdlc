import { prisma } from "@ai-sdlc/db";
import { notifyOrganizationRoles } from "../notification-events.js";

export async function processFindingSlaEscalation(
  notifier: typeof notifyOrganizationRoles = notifyOrganizationRoles,
): Promise<void> {
  const now = new Date();
  const overdueFindings = await prisma.securityFinding.findMany({
    where: {
      dueAt: { lt: now },
      status: { notIn: ["RESOLVED", "ACCEPTED", "FALSE_POSITIVE"] },
    },
    select: {
      id: true,
      organizationId: true,
      assigneeId: true,
      severity: true,
      title: true,
      dueAt: true,
    },
    orderBy: [{ dueAt: "asc" }, { id: "asc" }],
    take: 500,
  });

  for (const finding of overdueFindings) {
    if (!finding.dueAt) continue;
    const dueDate = finding.dueAt.toISOString();
    await notifier({
      organizationId: finding.organizationId,
      roles: ["OWNER", "ADMIN", "SECURITY"],
      ...(finding.assigneeId ? { userIds: [finding.assigneeId] } : {}),
      type: "FINDING_SLA_OVERDUE",
      title: "Finding remediation is overdue",
      body: `The ${finding.severity.toLowerCase()} finding “${finding.title}” passed its due date.`,
      href: "/dashboard/findings?overdue=true",
      dedupeKey: `finding-sla-overdue:${finding.id}:${dueDate}`,
    });
  }
}
