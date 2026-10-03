import { describe, it, expect, vi } from "vitest";
import { buildOrganizationScope, ensureOrganizationAccess } from "./index.js";

type OrganizationAccessPrisma = Parameters<typeof ensureOrganizationAccess>[0]["prisma"];

describe("@ai-sdlc/db", () => {
  it("exports prisma client", async () => {
    const { prisma } = await import("./index.js");
    expect(prisma).toBeDefined();
  });

  it("builds a tenant-scoped filter for organization resources", () => {
    expect(buildOrganizationScope("org-123")).toEqual({ organizationId: "org-123" });
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
    const prismaClient = {
      organizationMember: {
        findFirst: vi.fn().mockResolvedValue({ role: "ADMIN" }),
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
});
