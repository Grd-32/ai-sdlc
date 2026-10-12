import { describe, it, expect, vi } from "vitest";

process.env["DATABASE_URL"] =
  process.env["DATABASE_URL"] ??
  "postgresql://ai_sdlc:ai_sdlc_dev@localhost:5432/ai_sdlc?schema=public";
process.env["REDIS_URL"] = process.env["REDIS_URL"] ?? "redis://localhost:6379";

import {
  prisma,
  buildOrganizationScope,
  isOrganizationMember,
  ensureOrganizationAccess,
  buildRetentionCutoff,
  pruneExpiredSessions,
  pruneExpiredWebhookEvents,
  createServiceAccount,
  createApiKey,
  verifyApiKey,
  createPolicy,
  updatePolicyMode,
  normalizePolicyMode,
  registerAIProvider,
  registerAIAgent,
  registerAIModel,
  getAIApprovalStatus,
  registerSBOMComponent,
  recordRiskAcceptance,
  recordObservabilityEvent,
} from "./index.js";

type OrganizationAccessPrisma = Parameters<typeof ensureOrganizationAccess>[0]["prisma"];
type RetentionPrisma = Parameters<typeof pruneExpiredWebhookEvents>[0]["prisma"];

describe("@ai-sdlc/db", () => {
  it("exports prisma client", async () => {
    const { prisma } = await import("./index.js");
    expect(prisma).toBeDefined();
  });

  it("builds a tenant-scoped filter for organization resources", () => {
    expect(buildOrganizationScope("org-123")).toEqual({ organizationId: "org-123" });
  });

  it("checks membership only when SCIM has not deactivated it", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prismaClient = {
      organizationMember: { findFirst },
    } as unknown as OrganizationAccessPrisma;

    await expect(isOrganizationMember(prismaClient, "user-1", "org-a")).resolves.toBe(false);
    expect(findFirst).toHaveBeenCalledWith({
      where: { organizationId: "org-a", userId: "user-1", scimActive: true },
      select: { role: true },
    });
  });

  it("rejects cross-tenant access when the user is not a member of the organization", async () => {
    const prismaClient = {
      organizationMember: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    } as unknown as OrganizationAccessPrisma;

    await expect(
      ensureOrganizationAccess({
        prisma: prismaClient,
        userId: "user-1",
        organizationId: "org-b",
      }),
    ).rejects.toThrow("not a member of the requested organization");
  });

  it("allows access when the user has the required role in the organization", async () => {
    const findFirst = vi.fn().mockResolvedValue({ role: "ADMIN" });
    const prismaClient = {
      organizationMember: {
        findFirst,
      },
    } as unknown as OrganizationAccessPrisma;

    await expect(
      ensureOrganizationAccess({
        prisma: prismaClient,
        userId: "user-1",
        organizationId: "org-a",
        minimumRole: "ADMIN",
      }),
    ).resolves.toEqual({ organizationId: "org-a", role: "ADMIN" });
    expect(findFirst).toHaveBeenCalledWith({
      where: { organizationId: "org-a", userId: "user-1", scimActive: true },
      select: { role: true },
    });
  });

  it("rejects access when the user is below the minimum required role", async () => {
    const prismaClient = {
      organizationMember: {
        findFirst: vi.fn().mockResolvedValue({ role: "VIEWER" }),
      },
    } as unknown as OrganizationAccessPrisma;

    await expect(
      ensureOrganizationAccess({
        prisma: prismaClient,
        userId: "user-1",
        organizationId: "org-a",
        minimumRole: "SECURITY",
      }),
    ).rejects.toThrow("required role");
  });

  it("calculates the retention cutoff relative to now", () => {
    const now = new Date("2026-10-07T12:00:00.000Z");
    expect(buildRetentionCutoff(30, now).toISOString()).toBe("2026-09-07T12:00:00.000Z");
  });

  it("purges expired sessions and stale webhook deliveries using the retention cutoff", async () => {
    const sessionDeleteMany = vi.fn().mockResolvedValue({ count: 2 });
    const webhookDeleteMany = vi.fn().mockResolvedValue({ count: 5 });

    const now = new Date("2026-10-07T12:00:00.000Z");
    const sessionCount = await pruneExpiredSessions({
      prisma: {
        session: { deleteMany: sessionDeleteMany },
      } as any,
      now,
      maxAgeDays: 30,
    });
    const webhookCount = await pruneExpiredWebhookEvents({
      prisma: {
        gitHubWebhookEvent: { deleteMany: webhookDeleteMany },
      } as any,
      now,
      maxAgeDays: 90,
    });

    expect(sessionCount).toBe(2);
    expect(webhookCount).toBe(5);
    expect(sessionDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ expiresAt: { lt: new Date("2026-09-07T12:00:00.000Z") } }),
          ]),
        }),
      }),
    );
    expect(webhookDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ createdAt: { lt: new Date("2026-07-09T12:00:00.000Z") } }),
      }),
    );
  });

  it("applies per-organization webhook retention overrides and keeps global defaults elsewhere", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 4 });
    const now = new Date("2026-10-07T12:00:00.000Z");

    const count = await pruneExpiredWebhookEvents({
      prisma: { gitHubWebhookEvent: { deleteMany } } as unknown as RetentionPrisma,
      maxAgeDays: 90,
      now,
      organizationOverrides: [
        { organizationId: "org-short", maxAgeDays: 14 },
        { organizationId: "org-long", maxAgeDays: 180 },
      ],
    });

    expect(count).toBe(4);
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          {
            organizationId: null,
            createdAt: { lt: new Date("2026-07-09T12:00:00.000Z") },
            status: { in: ["COMPLETED", "FAILED", "DLQ"] },
          },
          {
            organizationId: { notIn: ["org-short", "org-long"] },
            createdAt: { lt: new Date("2026-07-09T12:00:00.000Z") },
            status: { in: ["COMPLETED", "FAILED", "DLQ"] },
          },
          {
            organizationId: { in: ["org-short"] },
            createdAt: { lt: new Date("2026-09-23T12:00:00.000Z") },
            status: { in: ["COMPLETED", "FAILED", "DLQ"] },
          },
          {
            organizationId: { in: ["org-long"] },
            createdAt: { lt: new Date("2026-04-10T12:00:00.000Z") },
            status: { in: ["COMPLETED", "FAILED", "DLQ"] },
          },
        ],
      },
    });
  });

  it("prunes only terminal webhook events and never deletes audit history", async () => {
    const webhookDeleteMany = vi.fn().mockResolvedValue({ count: 2 });
    const auditDeleteMany = vi.fn();
    const count = await pruneExpiredWebhookEvents({
      prisma: {
        gitHubWebhookEvent: { deleteMany: webhookDeleteMany },
        auditEvent: { deleteMany: auditDeleteMany },
      } as unknown as RetentionPrisma,
      maxAgeDays: 90,
      now: new Date("2026-10-07T12:00:00.000Z"),
    });

    expect(count).toBe(2);
    expect(webhookDeleteMany).toHaveBeenCalledWith({
      where: {
        createdAt: { lt: new Date("2026-07-09T12:00:00.000Z") },
        status: { in: ["COMPLETED", "FAILED", "DLQ"] },
      },
    });
    expect(auditDeleteMany).not.toHaveBeenCalled();
  });

  it("rejects invalid organization retention overrides before issuing deletes", async () => {
    const deleteMany = vi.fn();
    await expect(
      pruneExpiredWebhookEvents({
        prisma: { gitHubWebhookEvent: { deleteMany } } as unknown as RetentionPrisma,
        organizationOverrides: [{ organizationId: "org-a", maxAgeDays: -1 }],
      }),
    ).rejects.toThrow("retention override maxAgeDays must be an integer between 1 and 3650");
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("creates a service account and verifies a hashed API key", async () => {
    const organization = await prisma.organization.create({
      data: { name: "Service Account Org", slug: `sa-org-${Date.now()}` },
    });

    const serviceAccount = await createServiceAccount({
      prisma: prisma as any,
      organizationId: organization.id,
      name: "deployment-bot",
      description: "CI deployment automation",
      role: "ENGINEER",
    });

    const { secret, apiKey } = await createApiKey({
      prisma: prisma as any,
      organizationId: organization.id,
      serviceAccountId: serviceAccount.id,
      name: "deployment-bot-key",
    });

    expect(serviceAccount.name).toBe("deployment-bot");
    expect(secret.length).toBeGreaterThan(32);
    expect(apiKey.keyHash).toBeTruthy();
    expect(apiKey.organizationId).toBe(organization.id);
    expect(
      await verifyApiKey({ prisma: prisma as any, organizationId: organization.id, secret }),
    ).toBeTruthy();

    await prisma.serviceAccount.update({
      where: { id: serviceAccount.id },
      data: { active: false },
    });
    expect(
      await verifyApiKey({ prisma: prisma as any, organizationId: organization.id, secret }),
    ).toBe(false);

    await prisma.organization.delete({ where: { id: organization.id } });
  });

  it("normalizes and persists policy modes with safe dry-run defaults", async () => {
    const organization = await prisma.organization.create({
      data: { name: "Policy Mode Org", slug: `policy-mode-org-${Date.now()}` },
    });

    const policy = await createPolicy({
      prisma: prisma as any,
      organizationId: organization.id,
      name: "Production guardrail",
      description: "Safe default mode before enforcement",
      mode: "dry_run",
    });

    expect(normalizePolicyMode("dry_run")).toBe("DRY_RUN");
    expect(policy.mode).toBe("DRY_RUN");

    const updated = await updatePolicyMode({
      prisma: prisma as any,
      organizationId: organization.id,
      policyId: policy.id,
      mode: "ENFORCING",
    });

    expect(updated.mode).toBe("ENFORCING");

    await prisma.organization.delete({ where: { id: organization.id } });
  });

  it("registers approved AI providers, agents, and model policies", async () => {
    const organization = await prisma.organization.create({
      data: { name: "AI Governance Org", slug: `ai-governance-org-${Date.now()}` },
    });

    const provider = await registerAIProvider({
      prisma: prisma as any,
      organizationId: organization.id,
      name: "OpenAI",
      status: "APPROVED",
    });

    const agent = await registerAIAgent({
      prisma: prisma as any,
      organizationId: organization.id,
      providerId: provider.id,
      name: "Claude Code",
      status: "APPROVED",
    });

    const model = await registerAIModel({
      prisma: prisma as any,
      organizationId: organization.id,
      providerId: provider.id,
      name: "gpt-4o-mini",
      status: "APPROVED",
      version: "2024-07-18",
    });

    expect(provider.name).toBe("OpenAI");
    expect(agent.providerId).toBe(provider.id);
    expect(model.name).toBe("gpt-4o-mini");
    expect(
      await getAIApprovalStatus({
        prisma: prisma as any,
        organizationId: organization.id,
        providerName: provider.name,
        agentName: agent.name,
        modelName: model.name,
      }),
    ).toEqual({ provider: "APPROVED", agent: "APPROVED", model: "APPROVED" });

    await prisma.organization.delete({ where: { id: organization.id } });
  });

  it("tracks a supply-chain component and records an accepted risk", async () => {
    const organization = await prisma.organization.create({
      data: { name: "Supply Chain Org", slug: `supply-chain-org-${Date.now()}` },
    });

    const component = await registerSBOMComponent({
      prisma: prisma as any,
      organizationId: organization.id,
      name: "left-pad",
      version: null,
      ecosystem: null,
      status: "REVIEW",
    });

    const acceptance = await recordRiskAcceptance({
      prisma: prisma as any,
      organizationId: organization.id,
      componentId: component.id,
      acceptedBy: "security-team",
      reason: "Temporary exemption pending upgrade",
      expiresAt: new Date(Date.now() + 86400000),
    });

    expect(component.name).toBe("left-pad");
    expect(component.version).toBeNull();
    expect(component.ecosystem).toBe("NPM");
    expect(acceptance.status).toBe("ACCEPTED");
    expect(acceptance.acceptedBy).toBe("security-team");

    await prisma.organization.delete({ where: { id: organization.id } });
  });

  it("records a structured observability event with request and correlation IDs", async () => {
    const organization = await prisma.organization.create({
      data: { name: "Observability Org", slug: `observability-org-${Date.now()}` },
    });

    const event = await recordObservabilityEvent({
      prisma: prisma as any,
      organizationId: organization.id,
      service: "api",
      level: "INFO",
      message: "policy evaluation complete",
      requestId: "req-123",
      correlationId: "corr-456",
      metadata: { route: "/api/policies", latencyMs: 42 },
    });

    expect(event.message).toBe("policy evaluation complete");
    expect(event.requestId).toBe("req-123");
    expect(event.correlationId).toBe("corr-456");
    expect(event.level).toBe("INFO");

    await prisma.organization.delete({ where: { id: organization.id } });
  });
});
