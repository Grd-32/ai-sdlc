import { createHash } from "node:crypto";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "./types.js";

process.env["DATABASE_URL"] =
  process.env["DATABASE_URL"] ?? "postgresql://localhost:5432/ai_sdlc?schema=public";
process.env["REDIS_URL"] = process.env["REDIS_URL"] ?? "redis://localhost:6379";
process.env["SESSION_SECRET"] =
  process.env["SESSION_SECRET"] ?? "test-session-secret-do-not-use-in-prod";

vi.mock("@ai-sdlc/github", () => ({
  getInstallationDetails: vi.fn(() =>
    Promise.resolve({
      id: 42,
      account: { login: "tenant-isolation-test", type: "Organization" },
      permissions: { contents: "read" },
    }),
  ),
  listInstallationRepositories: vi.fn((installationId: string) =>
    Promise.resolve([
      {
        id: Number.parseInt(installationId.replace(/\D/g, "").slice(-8) || "42", 10),
        name: `repo-${installationId}`,
        full_name: `tenant-isolation-test/repo-${installationId}`,
        owner: { login: "tenant-isolation-test" },
        default_branch: "main",
        private: true,
      },
    ]),
  ),
}));

const { prisma } = await import("@ai-sdlc/db");
const { createSessionCookieValue } = await import("./auth/session.js");
const { requireAuth, requireOrganizationRole } = await import("./middleware/auth.js");
const { registerGitHubInstallationRoutes } = await import("./routes/github-installations.js");
const { registerScimRoutes } = await import("./routes/scim.js");

const app = new Hono<AppEnv>();
registerGitHubInstallationRoutes(app);
registerScimRoutes(app);
app.get(
  "/tenant-access-check/:organizationId",
  requireAuth,
  requireOrganizationRole("VIEWER"),
  (c) => c.json({ data: { ok: true }, error: null }),
);

const runId = Date.now().toString(36);
let organizationA: { id: string };
let organizationB: { id: string };
let adminId: string;
let sessionCookie: string;
let scimTokenA: string;
let scimTokenB: string;
const userIds: string[] = [];
let fixtureCreated = false;

function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

async function createSharedUser(suffix: string) {
  const user = await prisma.user.create({
    data: { email: `scim-shared-${suffix}-${runId}@example.test`, name: "Shared SCIM user" },
  });
  userIds.push(user.id);
  const sessionCookie = await createSessionCookieValue(user.id);
  const externalIdA = `scim-a-${suffix}-${runId}`;
  await prisma.organizationMember.createMany({
    data: [
      { organizationId: organizationA.id, userId: user.id, externalId: externalIdA },
      {
        organizationId: organizationB.id,
        userId: user.id,
        externalId: `scim-b-${suffix}-${runId}`,
      },
    ],
  });
  return { user, externalIdA, sessionCookie };
}

async function expectMembershipAccess(sessionCookie: string, isActiveInOrganizationA: boolean) {
  const headers = { Cookie: `ai_sdlc_session=${sessionCookie}` };
  const [responseA, responseB] = await Promise.all([
    app.request(`/tenant-access-check/${organizationA.id}`, { headers }),
    app.request(`/tenant-access-check/${organizationB.id}`, { headers }),
  ]);
  expect(responseA.status).toBe(isActiveInOrganizationA ? 200 : 403);
  expect(responseB.status).toBe(200);
}

beforeAll(async () => {
  organizationA = await prisma.organization.create({
    data: { name: `Lifecycle Isolation A ${runId}`, slug: `lifecycle-isolation-a-${runId}` },
  });
  organizationB = await prisma.organization.create({
    data: { name: `Lifecycle Isolation B ${runId}`, slug: `lifecycle-isolation-b-${runId}` },
  });

  const admin = await prisma.user.create({
    data: { email: `lifecycle-isolation-admin-${runId}@example.test`, name: "Lifecycle Admin" },
  });
  adminId = admin.id;
  await prisma.organizationMember.createMany({
    data: [
      { organizationId: organizationA.id, userId: admin.id, role: "OWNER" },
      { organizationId: organizationB.id, userId: admin.id, role: "OWNER" },
    ],
  });
  sessionCookie = await createSessionCookieValue(admin.id);

  scimTokenA = `scim-lifecycle-a-${runId}`;
  scimTokenB = `scim-lifecycle-b-${runId}`;
  await prisma.scimBearerToken.createMany({
    data: [
      { organizationId: organizationA.id, name: "test", tokenHash: tokenHash(scimTokenA) },
      { organizationId: organizationB.id, name: "test", tokenHash: tokenHash(scimTokenB) },
    ],
  });
  fixtureCreated = true;
});

afterAll(async () => {
  if (!fixtureCreated) {
    return;
  }
  const organizationIds = [organizationA.id, organizationB.id];
  await prisma.auditEvent.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.gitHubInstallation.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await prisma.scimBearerToken.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: [adminId, ...userIds] } } });
  await prisma.organizationMember.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await prisma.user.deleteMany({ where: { id: { in: [adminId, ...userIds] } } });
  await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
});

describe("tenant-scoped identity lifecycle", () => {
  it("does not reassign a GitHub installation owned by another organization", async () => {
    const installationId = `github-installation-${runId}`;
    const existing = await prisma.gitHubInstallation.create({
      data: {
        organizationId: organizationB.id,
        githubInstallationId: installationId,
        accountLogin: "org-b-account",
      },
    });

    const response = await app.request(
      `/api/github/installations/callback?installation_id=${installationId}&state=${organizationA.id}`,
      { headers: { Cookie: `ai_sdlc_session=${sessionCookie}` } },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain(
      "installError=installation_owned_by_another_organization",
    );
    const persisted = await prisma.gitHubInstallation.findUniqueOrThrow({
      where: { githubInstallationId: installationId },
    });
    expect(persisted.id).toBe(existing.id);
    expect(persisted.organizationId).toBe(organizationB.id);
    expect(persisted.accountLogin).toBe("org-b-account");
  });

  it("links a new installation and permits reconnecting one owned by the same organization", async () => {
    const newInstallationId = `github-installation-new-${runId}`;
    const newResponse = await app.request(
      `/api/github/installations/callback?installation_id=${newInstallationId}&state=${organizationA.id}`,
      { headers: { Cookie: `ai_sdlc_session=${sessionCookie}` } },
    );
    expect(newResponse.status).toBe(302);
    expect(newResponse.headers.get("location")).toContain("installed=");
    const created = await prisma.gitHubInstallation.findUniqueOrThrow({
      where: { githubInstallationId: newInstallationId },
    });
    expect(created.organizationId).toBe(organizationA.id);
    const synchronizedRepository = await prisma.repository.findFirstOrThrow({
      where: { organizationId: organizationA.id, githubInstallationId: created.id },
    });
    expect(synchronizedRepository.name).toBe(`repo-${newInstallationId}`);

    const sameOrgId = `github-installation-same-org-${runId}`;
    await prisma.gitHubInstallation.create({
      data: {
        organizationId: organizationA.id,
        githubInstallationId: sameOrgId,
        accountLogin: "old-account-name",
      },
    });
    const reconnectResponse = await app.request(
      `/api/github/installations/callback?installation_id=${sameOrgId}&state=${organizationA.id}`,
      { headers: { Cookie: `ai_sdlc_session=${sessionCookie}` } },
    );
    expect(reconnectResponse.status).toBe(302);
    expect(reconnectResponse.headers.get("location")).toContain("installed=");
    const reconnected = await prisma.gitHubInstallation.findUniqueOrThrow({
      where: { githubInstallationId: sameOrgId },
    });
    expect(reconnected.organizationId).toBe(organizationA.id);
    expect(reconnected.accountLogin).toBe("tenant-isolation-test");
  });

  it("uses the short-lived web callback context when GitHub omits setup state", async () => {
    const installationId = `github-installation-state-cookie-${runId}`;
    const response = await app.request(
      `/api/github/installations/callback?installation_id=${installationId}&setup_action=update`,
      {
        headers: {
          Cookie: `ai_sdlc_session=${sessionCookie}; ai_sdlc_github_installation_org=${organizationA.id}`,
        },
      },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("installed=");
    expect(response.headers.get("set-cookie")).toContain("ai_sdlc_github_installation_org=");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    const installation = await prisma.gitHubInstallation.findUniqueOrThrow({
      where: { githubInstallationId: installationId },
    });
    expect(installation.organizationId).toBe(organizationA.id);
    const repository = await prisma.repository.findFirstOrThrow({
      where: { organizationId: organizationA.id, githubInstallationId: installation.id },
    });
    expect(repository.enabled).toBe(true);
  });

  it("SCIM POST deactivation only changes the target organization's membership", async () => {
    const { user, sessionCookie } = await createSharedUser("post");
    const response = await app.request("/scim/v2/Users", {
      method: "POST",
      headers: { Authorization: `Bearer ${scimTokenA}`, "Content-Type": "application/scim+json" },
      body: JSON.stringify({ userName: user.email, externalId: `post-${runId}`, active: false }),
    });
    expect(response.status).toBe(201);
    expect(((await response.json()) as { active: boolean }).active).toBe(false);

    const memberships = await prisma.organizationMember.findMany({
      where: { userId: user.id },
      orderBy: { organizationId: "asc" },
    });
    expect(memberships.find((item) => item.organizationId === organizationA.id)?.scimActive).toBe(
      false,
    );
    expect(memberships.find((item) => item.organizationId === organizationB.id)?.scimActive).toBe(
      true,
    );
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).active).toBe(true);
    await expectMembershipAccess(sessionCookie, false);
  });

  it("SCIM PATCH deactivation does not disable a shared user account or other membership", async () => {
    const { user, externalIdA, sessionCookie } = await createSharedUser("patch");
    const response = await app.request(`/scim/v2/Users/${externalIdA}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${scimTokenA}`, "Content-Type": "application/scim+json" },
      body: JSON.stringify({ Operations: [{ op: "replace", path: "active", value: false }] }),
    });
    expect(response.status).toBe(200);

    const memberships = await prisma.organizationMember.findMany({ where: { userId: user.id } });
    expect(memberships.find((item) => item.organizationId === organizationA.id)?.scimActive).toBe(
      false,
    );
    expect(memberships.find((item) => item.organizationId === organizationB.id)?.scimActive).toBe(
      true,
    );
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).active).toBe(true);
    await expectMembershipAccess(sessionCookie, false);
  });

  it("SCIM DELETE deactivation does not disable a shared user account or other membership", async () => {
    const { user, externalIdA, sessionCookie } = await createSharedUser("delete");
    const response = await app.request(`/scim/v2/Users/${externalIdA}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${scimTokenA}` },
    });
    expect(response.status).toBe(204);

    const memberships = await prisma.organizationMember.findMany({ where: { userId: user.id } });
    expect(memberships.find((item) => item.organizationId === organizationA.id)?.scimActive).toBe(
      false,
    );
    expect(memberships.find((item) => item.organizationId === organizationB.id)?.scimActive).toBe(
      true,
    );
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).active).toBe(true);
    await expectMembershipAccess(sessionCookie, false);
  });
});
