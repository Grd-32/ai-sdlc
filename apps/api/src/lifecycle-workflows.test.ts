import { createHash, randomBytes } from "node:crypto";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "./types.js";

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
process.env["DATABASE_URL"] =
  testDatabaseUrl ?? "postgresql://test:test@127.0.0.1:1/nomalog_test";

const githubMocks = vi.hoisted(() => ({
  githubApiRequest: vi.fn(),
}));

vi.mock("@ai-sdlc/github", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ai-sdlc/github")>();
  return { ...actual, githubApiRequest: githubMocks.githubApiRequest };
});

const { prisma } = await import("@ai-sdlc/db");
const { createSessionCookieValue } = await import("./auth/session.js");
const { registerOnboardingRoutes } = await import("./routes/onboarding.js");
const { registerScimRoutes } = await import("./routes/scim.js");
const { registerSettingsRoutes } = await import("./routes/settings.js");
const { registerRemediationRoutes } = await import("./routes/remediation.js");

const app = new Hono<AppEnv>();
registerOnboardingRoutes(app);
registerScimRoutes(app);
registerSettingsRoutes(app);
registerRemediationRoutes(app);

const runId = `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
let organizationId = "";
let organizationSlug = "";
let ownerId = "";
let ownerCookie = "";
let inviteeId = "";
let scimUserId = "";
let inviteeCookie = "";
let deletionRequestId = "";
let scimToken = "";
let originalOperatorIds: string | undefined;

const authHeaders = (cookie: string) => ({
  Cookie: `ai_sdlc_session=${cookie}`,
  "Content-Type": "application/json",
});

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

describe.skipIf(!testDatabaseUrl)("organization lifecycle workflows", () => {
  beforeAll(async () => {
    originalOperatorIds = process.env["DATA_DELETION_OPERATOR_USER_IDS"];
    const organization = await prisma.organization.create({
      data: { name: `Lifecycle ${runId}`, slug: `lifecycle-${runId}` },
      select: { id: true, slug: true },
    });
    organizationId = organization.id;
    organizationSlug = organization.slug;
    const owner = await prisma.user.create({
      data: { email: `lifecycle-owner-${runId}@example.test` },
      select: { id: true },
    });
    ownerId = owner.id;
    await prisma.organizationMember.create({
      data: { organizationId, userId: ownerId, role: "OWNER" },
    });
    ownerCookie = await createSessionCookieValue(ownerId);
  });

  afterAll(async () => {
    if (organizationId) {
      await prisma.organization.deleteMany({ where: { id: organizationId } });
    }
    if (deletionRequestId) {
      await prisma.organizationDeletionRequest.deleteMany({
        where: { id: deletionRequestId },
      });
    }
    if (inviteeId) await prisma.user.deleteMany({ where: { id: inviteeId } });
    if (scimUserId) await prisma.user.deleteMany({ where: { id: scimUserId } });
    if (ownerId) await prisma.user.deleteMany({ where: { id: ownerId } });
    if (originalOperatorIds === undefined) {
      delete process.env["DATA_DELETION_OPERATOR_USER_IDS"];
    } else {
      process.env["DATA_DELETION_OPERATOR_USER_IDS"] = originalOperatorIds;
    }
    await prisma.$disconnect();
  });

  it("creates and accepts an expiring invitation only for the invited account", async () => {
    const email = `lifecycle-invitee-${runId}@example.test`;
    const createResponse = await app.request(
      `/api/organizations/${organizationId}/member-invitations`,
      {
        method: "POST",
        headers: authHeaders(ownerCookie),
        body: JSON.stringify({ email, role: "ENGINEER" }),
      },
    );
    expect(createResponse.status).toBe(201);

    const invitee = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    });
    inviteeId = invitee.id;
    inviteeCookie = await createSessionCookieValue(inviteeId);
    const notification = await prisma.notification.findFirstOrThrow({
      where: {
        organizationId,
        userId: inviteeId,
        type: "ORGANIZATION_INVITATION_CREATED",
      },
      select: { href: true },
    });
    const token = new URL(notification.href ?? "", "http://localhost").searchParams.get("token");
    expect(token).toBeTruthy();

    const accepted = await app.request("/api/invitations/accept", {
      method: "POST",
      headers: authHeaders(inviteeCookie),
      body: JSON.stringify({ token }),
    });
    expect(accepted.status).toBe(200);
    await expect(
      prisma.organizationMember.findUniqueOrThrow({
        where: {
          organizationId_userId: { organizationId, userId: inviteeId },
        },
        select: { role: true, scimActive: true },
      }),
    ).resolves.toMatchObject({ role: "ENGINEER", scimActive: true });

    const replay = await app.request("/api/invitations/accept", {
      method: "POST",
      headers: authHeaders(inviteeCookie),
      body: JSON.stringify({ token }),
    });
    expect(replay.status).toBe(404);
  });

  it("supports SCIM group membership and role synchronization within its organization", async () => {
    const token = randomBytes(32).toString("base64url");
    await prisma.scimBearerToken.create({
      data: {
        organizationId,
        name: `test-${runId}`,
        tokenHash: hashToken(token),
      },
    });
    scimToken = token;
    const email = `lifecycle-scim-${runId}@example.test`;
    const user = await prisma.user.create({
      data: { email },
      select: { id: true },
    });
    scimUserId = user.id;
    const externalId = `scim-member-${runId}`;
    await prisma.organizationMember.create({
      data: { organizationId, userId: user.id, externalId },
    });

    const created = await app.request("/scim/v2/Groups", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${scimToken}`,
        "Content-Type": "application/scim+json",
      },
      body: JSON.stringify({
        externalId: `developers-${runId}`,
        displayName: "Developers",
        members: [{ value: externalId }],
      }),
    });
    expect(created.status).toBe(201);
    const group = (await created.json()) as { id: string; members: Array<{ value: string }> };
    expect(group.members.map(({ value }) => value)).toContain(externalId);
    await expect(
      prisma.organizationMember.findUniqueOrThrow({
        where: { organizationId_userId: { organizationId, userId: user.id } },
        select: { role: true, scimManagedRole: true },
      }),
    ).resolves.toMatchObject({ role: "ENGINEER", scimManagedRole: true });

    const removed = await app.request(`/scim/v2/Groups/${encodeURIComponent(group.id)}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${scimToken}`,
        "Content-Type": "application/scim+json",
      },
      body: JSON.stringify({
        Operations: [{ op: "remove", path: "members", value: [{ value: externalId }] }],
      }),
    });
    expect(removed.status).toBe(200);
    await expect(
      prisma.organizationMember.findUniqueOrThrow({
        where: { organizationId_userId: { organizationId, userId: user.id } },
        select: { role: true, scimManagedRole: true },
      }),
    ).resolves.toMatchObject({ role: "VIEWER", scimManagedRole: false });
  });

  it("marks a GitHub finding verified only after its exact alert is fixed", async () => {
    const installation = await prisma.gitHubInstallation.create({
      data: {
        organizationId,
        githubInstallationId: `github-installation-${runId}`,
      },
    });
    const repository = await prisma.repository.create({
      data: {
        organizationId,
        githubInstallationId: installation.id,
        provider: "GITHUB",
        owner: "lifecycle",
        name: `verify-${runId}`,
      },
    });
    const finding = await prisma.securityFinding.create({
      data: {
        organizationId,
        repositoryId: repository.id,
        provider: "GitHub Code Scanning / CodeQL",
        providerFindingId: "7",
        title: "Test CodeQL finding",
        status: "OPEN",
      },
      select: { id: true },
    });
    const path = `/api/organizations/${organizationId}/findings/${finding.id}/verify-resolution`;
    githubMocks.githubApiRequest.mockResolvedValueOnce({
      number: 7,
      state: "open",
      html_url: "https://example.test/alert/7",
    });

    const unresolved = await app.request(path, {
      method: "POST",
      headers: authHeaders(ownerCookie),
    });
    expect(unresolved.status).toBe(409);
    await expect(
      prisma.securityFinding.findUniqueOrThrow({
        where: { id: finding.id },
        select: { status: true, resolutionVerification: true },
      }),
    ).resolves.toMatchObject({
      status: "OPEN",
      resolutionVerification: "NOT_VERIFIED",
    });

    githubMocks.githubApiRequest.mockResolvedValueOnce({
      number: 7,
      state: "fixed",
      html_url: "https://example.test/alert/7",
    });
    const fixed = await app.request(path, {
      method: "POST",
      headers: authHeaders(ownerCookie),
    });
    expect(fixed.status).toBe(200);
    await expect(
      prisma.securityFinding.findUniqueOrThrow({
        where: { id: finding.id },
        select: { status: true, resolutionVerification: true },
      }),
    ).resolves.toMatchObject({
      status: "RESOLVED",
      resolutionVerification: "PROVIDER_VERIFIED",
    });
    await expect(
      prisma.findingResolutionEvidence.findFirstOrThrow({
        where: { securityFindingId: finding.id },
        select: { provider: true, providerFindingId: true, providerState: true },
      }),
    ).resolves.toMatchObject({
      provider: "GITHUB_CODE_SCANNING",
      providerFindingId: "7",
      providerState: "fixed",
    });
    expect(githubMocks.githubApiRequest).toHaveBeenLastCalledWith(
      `github-installation-${runId}`,
      expect.stringContaining("/code-scanning/alerts/7"),
    );
  });

  it("requires an allowlisted operator and cleanup attestation before erasing a tenant", async () => {
    const request = await prisma.organizationDeletionRequest.create({
      data: {
        organizationId,
        organizationSlug,
        requestedById: ownerId,
      },
      select: { id: true },
    });
    deletionRequestId = request.id;
    process.env["DATA_DELETION_OPERATOR_USER_IDS"] = ownerId;

    const rejected = await app.request(
      `/api/operator/organization-deletion-requests/${request.id}/approve`,
      {
        method: "POST",
        headers: authHeaders(ownerCookie),
        body: JSON.stringify({
          confirmOrganizationSlug: organizationSlug,
          externalCleanupConfirmed: false,
        }),
      },
    );
    expect(rejected.status).toBe(400);
    expect(await prisma.organization.findUnique({ where: { id: organizationId } })).not.toBeNull();

    const approved = await app.request(
      `/api/operator/organization-deletion-requests/${request.id}/approve`,
      {
        method: "POST",
        headers: authHeaders(ownerCookie),
        body: JSON.stringify({
          confirmOrganizationSlug: organizationSlug,
          externalCleanupConfirmed: true,
          externalCleanupSummary:
            "Stripe subscription canceled and linked source-control access revoked.",
        }),
      },
    );
    expect(approved.status).toBe(200);
    expect(await prisma.organization.findUnique({ where: { id: organizationId } })).toBeNull();
    await expect(
      prisma.organizationDeletionRequest.findUniqueOrThrow({
        where: { id: request.id },
        select: { status: true, organizationId: true, organizationSlug: true },
      }),
    ).resolves.toMatchObject({
      status: "COMPLETED",
      organizationId: null,
      organizationSlug,
    });
    organizationId = "";
  });
});
