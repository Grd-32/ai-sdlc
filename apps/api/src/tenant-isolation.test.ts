import { describe, it, expect, beforeAll, afterAll } from "vitest";
process.env["DATABASE_URL"] =
  process.env["DATABASE_URL"] ??
  "postgresql://ai_sdlc:ai_sdlc_dev@localhost:5432/ai_sdlc?schema=public";
process.env["REDIS_URL"] = process.env["REDIS_URL"] ?? "redis://localhost:6379";
process.env["SESSION_SECRET"] =
  process.env["SESSION_SECRET"] ?? "test-session-secret-do-not-use-in-prod";

import { computeAuditEventIntegrityHash, prisma } from "@ai-sdlc/db";

const { app } = await import("./app.js");
const { createSessionCookieValue } = await import("./auth/session.js");

// Unique per run so repeated test runs never collide with a previous run's
// leftovers, even if a prior afterAll failed to clean up (e.g. a crashed process).
const runId = Date.now().toString(36);

let orgA: { id: string };
let orgB: { id: string };
let userA: { id: string };
let userB: { id: string };
let adminA: { id: string };
let viewerA: { id: string };
let sessionA: string;
let sessionB: string;
let adminSessionA: string;
let viewerSessionA: string;

beforeAll(async () => {
  orgA = await prisma.organization.create({
    data: { name: `Tenant Isolation Test Org A ${runId}`, slug: `tenant-test-a-${runId}` },
  });
  orgB = await prisma.organization.create({
    data: { name: `Tenant Isolation Test Org B ${runId}`, slug: `tenant-test-b-${runId}` },
  });

  userA = await prisma.user.create({
    data: { email: `tenant-test-a-${runId}@example.test`, name: "Tenant Test User A" },
  });
  userB = await prisma.user.create({
    data: { email: `tenant-test-b-${runId}@example.test`, name: "Tenant Test User B" },
  });

  await prisma.organizationMember.create({
    data: { organizationId: orgA.id, userId: userA.id, role: "OWNER" },
  });
  await prisma.organizationMember.create({
    data: { organizationId: orgB.id, userId: userB.id, role: "OWNER" },
  });

  adminA = await prisma.user.create({
    data: { email: `tenant-admin-${runId}@example.test`, name: "Tenant Admin" },
  });
  viewerA = await prisma.user.create({
    data: { email: `tenant-viewer-${runId}@example.test`, name: "Tenant Viewer" },
  });
  await prisma.organizationMember.create({
    data: { organizationId: orgA.id, userId: adminA.id, role: "ADMIN" },
  });
  await prisma.organizationMember.create({
    data: { organizationId: orgA.id, userId: viewerA.id, role: "VIEWER" },
  });

  sessionA = await createSessionCookieValue(userA.id);
  sessionB = await createSessionCookieValue(userB.id);
  adminSessionA = await createSessionCookieValue(adminA.id);
  viewerSessionA = await createSessionCookieValue(viewerA.id);
});

afterAll(async () => {
  // Children before parents, to satisfy FK constraints.
  await prisma.organizationMember.deleteMany({
    where: { organizationId: { in: [orgA.id, orgB.id] } },
  });
  await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
  await prisma.user.deleteMany({ where: { id: { in: [adminA.id, viewerA.id] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
});

function authHeader(session: string): { Cookie: string } {
  return { Cookie: `ai_sdlc_session=${session}` };
}

describe("Tenant isolation (README §1/§47 — never trust a client-supplied organizationId)", () => {
  it("a user can access their own organization's overview", async () => {
    const res = await app.request(`/api/organizations/${orgA.id}/overview`, {
      headers: authHeader(sessionA),
    });
    expect(res.status).toBe(200);
  });

  it("a user from Org A cannot access Org B's overview", async () => {
    const res = await app.request(`/api/organizations/${orgB.id}/overview`, {
      headers: authHeader(sessionA),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } | null };
    expect(body.error?.code).toBe("FORBIDDEN");
  });

  it("a user from Org B cannot access Org A's overview (symmetric check)", async () => {
    const res = await app.request(`/api/organizations/${orgA.id}/overview`, {
      headers: authHeader(sessionB),
    });
    expect(res.status).toBe(403);
  });

  it("cannot access another org's pull-requests, repositories, policies, or evidence", async () => {
    const endpoints = ["pull-requests", "repositories", "policies", "evidence", "export"];
    for (const endpoint of endpoints) {
      const res = await app.request(`/api/organizations/${orgB.id}/${endpoint}`, {
        headers: authHeader(sessionA),
      });
      expect(res.status).toBe(403);
    }
  });

  it("exports organization data for an admin without exposing API key hashes", async () => {
    const repository = await prisma.repository.create({
      data: {
        organizationId: orgA.id,
        owner: "tenant-a",
        name: `export-test-${runId}`,
      },
    });
    await prisma.apiKey.create({
      data: {
        organizationId: orgA.id,
        name: "export-redaction-test",
        keyHash: `export-test-hash-${runId}`,
      },
    });
    await prisma.scimBearerToken.create({
      data: {
        organizationId: orgA.id,
        name: "export-redaction-test",
        tokenHash: `scim-export-test-hash-${runId}`,
      },
    });
    await prisma.identityProvider.create({
      data: {
        organizationId: orgA.id,
        type: "OIDC",
        name: "export-redaction-test",
        metadata: {
          endpoint: "https://idp.example.test",
          clientSecret: `client-secret-${runId}`,
          nested: { privateKey: `private-key-${runId}` },
        },
      },
    });

    const res = await app.request(`/api/organizations/${orgA.id}/export`, {
      headers: authHeader(sessionA),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        organization: {
          id: string;
          repositories: Array<{ id: string }>;
          apiKeys: Array<Record<string, unknown>>;
          scimTokens: Array<Record<string, unknown>>;
          identityProviders: Array<{ metadata: Record<string, unknown> }>;
        };
      };
    };
    expect(body.data.organization.id).toBe(orgA.id);
    expect(body.data.organization.repositories.map((item) => item.id)).toContain(repository.id);
    expect(JSON.stringify(body)).not.toContain(`export-test-hash-${runId}`);
    expect(JSON.stringify(body)).not.toContain(`scim-export-test-hash-${runId}`);
    expect(JSON.stringify(body)).not.toContain(`client-secret-${runId}`);
    expect(JSON.stringify(body)).not.toContain(`private-key-${runId}`);
    expect(body.data.organization.apiKeys[0]).not.toHaveProperty("keyHash");
    expect(body.data.organization.scimTokens[0]).not.toHaveProperty("tokenHash");
    expect(body.data.organization.identityProviders[0]?.metadata).toEqual({
      endpoint: "https://idp.example.test",
      nested: {},
    });
  });

  it("does not persist or return secret-like identity-provider metadata", async () => {
    const secret = `idp-secret-${runId}`;
    const response = await app.request(`/api/organizations/${orgA.id}/identity-providers`, {
      method: "POST",
      headers: { ...authHeader(sessionA), "content-type": "application/json" },
      body: JSON.stringify({
        name: "metadata-redaction-test",
        type: "OIDC",
        metadata: { issuerUrl: "https://idp.example.test", clientSecret: secret },
      }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      data: { id: string; metadata: Record<string, unknown> };
    };
    expect(JSON.stringify(body)).not.toContain(secret);
    expect(body.data.metadata).toEqual({ issuerUrl: "https://idp.example.test" });

    const persisted = await prisma.identityProvider.findUnique({
      where: { id: body.data.id },
      select: { metadata: true },
    });
    expect(persisted?.metadata).toEqual({ issuerUrl: "https://idp.example.test" });

    const auditEvent = await prisma.auditEvent.findFirst({
      where: { organizationId: orgA.id, eventType: "IDENTITY_PROVIDER_CREATED", actorId: userA.id },
      orderBy: { createdAt: "desc" },
    });
    expect(JSON.stringify(auditEvent)).not.toContain(secret);
  });

  it("allows admins to configure only their organization's webhook retention", async () => {
    const path = `/api/organizations/${orgA.id}/settings/retention`;
    const update = await app.request(path, {
      method: "PATCH",
      headers: { ...authHeader(sessionA), "content-type": "application/json" },
      body: JSON.stringify({ webhookRetentionDays: 45 }),
    });

    expect(update.status).toBe(200);
    const updatedBody = (await update.json()) as { data: { webhookRetentionDays: number | null } };
    expect(updatedBody.data.webhookRetentionDays).toBe(45);

    const auditEvent = await prisma.auditEvent.findFirst({
      where: {
        organizationId: orgA.id,
        actorId: userA.id,
        eventType: "ORGANIZATION_RETENTION_UPDATED",
        metadata: { path: ["webhookRetentionDays"], equals: 45 },
      },
      orderBy: { createdAt: "desc" },
    });
    expect(auditEvent).not.toBeNull();
    const auditMetadata = auditEvent?.metadata as Record<string, unknown> | null;
    const { integrityHash, previousHash, ...baseMetadata } = auditMetadata ?? {};
    expect(integrityHash).toBe(
      computeAuditEventIntegrityHash({
        organizationId: orgA.id,
        eventType: "ORGANIZATION_RETENTION_UPDATED",
        actorId: userA.id,
        metadata: baseMetadata,
        createdAt: auditEvent?.createdAt,
        previousHash: typeof previousHash === "string" ? previousHash : null,
      }),
    );

    const read = await app.request(path, { headers: authHeader(sessionA) });
    expect(read.status).toBe(200);
    const readBody = (await read.json()) as { data: { webhookRetentionDays: number | null } };
    expect(readBody.data.webhookRetentionDays).toBe(45);

    const invalid = await app.request(path, {
      method: "PATCH",
      headers: { ...authHeader(sessionA), "content-type": "application/json" },
      body: JSON.stringify({ webhookRetentionDays: 0 }),
    });
    expect(invalid.status).toBe(400);

    const reset = await app.request(path, {
      method: "PATCH",
      headers: { ...authHeader(sessionA), "content-type": "application/json" },
      body: JSON.stringify({ webhookRetentionDays: null }),
    });
    expect(reset.status).toBe(200);
    const resetBody = (await reset.json()) as { data: { webhookRetentionDays: number | null } };
    expect(resetBody.data.webhookRetentionDays).toBeNull();

    const crossTenant = await app.request(`/api/organizations/${orgB.id}/settings/retention`, {
      method: "PATCH",
      headers: { ...authHeader(sessionA), "content-type": "application/json" },
      body: JSON.stringify({ webhookRetentionDays: 45 }),
    });
    expect(crossTenant.status).toBe(403);
  });

  it("rejects requests with no session at all", async () => {
    const res = await app.request(`/api/organizations/${orgA.id}/overview`);
    expect(res.status).toBe(401);
  });

  it("rejects a forged/invalid session cookie", async () => {
    const res = await app.request(`/api/organizations/${orgA.id}/overview`, {
      headers: { Cookie: "ai_sdlc_session=not-a-real-session" },
    });
    expect(res.status).toBe(401);
  });

  it("prevents admins from granting owner privileges or modifying owners", async () => {
    const addOwner = await app.request(`/api/organizations/${orgA.id}/members`, {
      method: "POST",
      headers: { ...authHeader(adminSessionA), "content-type": "application/json" },
      body: JSON.stringify({ email: `new-owner-${runId}@example.test`, role: "OWNER" }),
    });
    expect(addOwner.status).toBe(403);

    const demoteOwnerByUpsert = await app.request(`/api/organizations/${orgA.id}/members`, {
      method: "POST",
      headers: { ...authHeader(adminSessionA), "content-type": "application/json" },
      body: JSON.stringify({ email: `tenant-test-a-${runId}@example.test`, role: "VIEWER" }),
    });
    expect(demoteOwnerByUpsert.status).toBe(403);

    const viewerMembership = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgA.id, userId: viewerA.id } },
    });
    const promoteViewer = await app.request(
      `/api/organizations/${orgA.id}/members/${viewerMembership?.id}`,
      {
        method: "PATCH",
        headers: { ...authHeader(adminSessionA), "content-type": "application/json" },
        body: JSON.stringify({ role: "OWNER" }),
      },
    );
    expect(promoteViewer.status).toBe(403);
    const unchangedViewer = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgA.id, userId: viewerA.id } },
    });
    expect(unchangedViewer?.role).toBe("VIEWER");

    const ownerMembership = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgA.id, userId: userA.id } },
    });
    const demoteOwner = await app.request(
      `/api/organizations/${orgA.id}/members/${ownerMembership?.id}`,
      {
        method: "PATCH",
        headers: { ...authHeader(adminSessionA), "content-type": "application/json" },
        body: JSON.stringify({ role: "VIEWER" }),
      },
    );
    expect(demoteOwner.status).toBe(403);
  });

  it("prevents viewers from calling organization member administration routes", async () => {
    const response = await app.request(`/api/organizations/${orgA.id}/members`, {
      method: "POST",
      headers: { ...authHeader(viewerSessionA), "content-type": "application/json" },
      body: JSON.stringify({ email: `viewer-added-${runId}@example.test`, role: "VIEWER" }),
    });

    expect(response.status).toBe(403);
  });

  it("GET /api/organizations only lists organizations the caller belongs to", async () => {
    const res = await app.request("/api/organizations", { headers: authHeader(sessionA) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ id: string }> };
    const ids = body.data.map((org) => org.id);
    expect(ids).toContain(orgA.id);
    expect(ids).not.toContain(orgB.id);
  });
});
