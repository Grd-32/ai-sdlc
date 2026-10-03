import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@ai-sdlc/db";

process.env["DATABASE_URL"] =
  process.env["DATABASE_URL"] ?? "postgresql://ai_sdlc:ai_sdlc_dev@localhost:5432/ai_sdlc?schema=public";
process.env["REDIS_URL"] = process.env["REDIS_URL"] ?? "redis://localhost:6379";
process.env["SESSION_SECRET"] = process.env["SESSION_SECRET"] ?? "test-session-secret-do-not-use-in-prod";

const { app } = await import("./app.js");
const { createSessionCookieValue } = await import("./auth/session.js");

// Unique per run so repeated test runs never collide with a previous run's
// leftovers, even if a prior afterAll failed to clean up (e.g. a crashed process).
const runId = Date.now().toString(36);

let orgA: { id: string };
let orgB: { id: string };
let userA: { id: string };
let userB: { id: string };
let sessionA: string;
let sessionB: string;

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

  sessionA = createSessionCookieValue(userA.id);
  sessionB = createSessionCookieValue(userB.id);
});

afterAll(async () => {
  // Children before parents, to satisfy FK constraints.
  await prisma.organizationMember.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
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
    const endpoints = ["pull-requests", "repositories", "policies", "evidence"];
    for (const endpoint of endpoints) {
      const res = await app.request(`/api/organizations/${orgB.id}/${endpoint}`, {
        headers: authHeader(sessionA),
      });
      expect(res.status).toBe(403);
    }
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

  it("GET /api/organizations only lists organizations the caller belongs to", async () => {
    const res = await app.request("/api/organizations", { headers: authHeader(sessionA) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ id: string }> };
    const ids = body.data.map((org) => org.id);
    expect(ids).toContain(orgA.id);
    expect(ids).not.toContain(orgB.id);
  });
});