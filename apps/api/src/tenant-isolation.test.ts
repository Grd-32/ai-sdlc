import { describe, it, expect, beforeAll, afterAll } from "vitest";
process.env["DATABASE_URL"] =
  process.env["DATABASE_URL"] ??
  "postgresql://ai_sdlc:ai_sdlc_dev@localhost:5432/ai_sdlc?schema=public";
const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
process.env["DATABASE_URL"] =
  testDatabaseUrl ?? "postgresql://test:test@127.0.0.1:1/nomalog_test";
process.env["REDIS_URL"] = process.env["REDIS_URL"] ?? "redis://localhost:6379";
process.env["SESSION_SECRET"] =
  process.env["SESSION_SECRET"] ?? "test-session-secret-do-not-use-in-prod";

import { computeAuditEventIntegrityHash, hashChangePassportRevision, prisma } from "@ai-sdlc/db";

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
let setupComplete = false;

async function createFixtures() {
  orgA = await prisma.organization.create({
    data: { name: `Tenant Isolation Test Org A ${runId}`, slug: `tenant-test-a-${runId}` },
    },
  );
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
  setupComplete = true;
}

async function removeFixtures() {
  if (!setupComplete) return;
  const organizationIds = [orgA.id, orgB.id];
  // Children before parents, to satisfy FK constraints.
  await prisma.assessment.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.organizationMember.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  const userIds = [userA.id, userB.id, adminA.id, viewerA.id];
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
}

function authHeader(session: string): { Cookie: string } {
  return { Cookie: `ai_sdlc_session=${session}` };
}

describe.skipIf(!testDatabaseUrl)(
  "Tenant isolation (README §1/§47 — never trust a client-supplied organizationId)",
  () => {
    beforeAll(createFixtures);
    afterAll(removeFixtures);
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
    const endpoints = [
      "pull-requests",
      "repositories",
      "policies",
      "evidence",
      "export",
      "findings",
      "notifications",
      "governance-analytics",
    ];
    for (const endpoint of endpoints) {
      const res = await app.request(`/api/organizations/${orgB.id}/${endpoint}`, {
        headers: authHeader(sessionA),
      });
      expect(res.status).toBe(403);
    }
  });

  it("tracks finding triage, risk acceptance, expiry, and reopening", async () => {
    const finding = await prisma.securityFinding.create({
      data: {
        organizationId: orgA.id,
        provider: "test",
        title: `remediation-test-${runId}`,
        severity: "HIGH",
      },
      select: { id: true },
    });
    const path = `/api/organizations/${orgA.id}/findings/${finding.id}`;
    const headers = { ...authHeader(sessionA), "content-type": "application/json" };

    const triage = await app.request(path, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ status: "TRIAGED", dueAt: "2027-01-01T00:00:00.000Z" }),
    });
    expect(triage.status).toBe(200);

    const accepted = await app.request(path, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        status: "ACCEPTED",
        comment: "Accepted while the upstream dependency is being replaced.",
        acceptanceExpiresAt: "2027-12-01T00:00:00.000Z",
      }),
    });
    expect(accepted.status).toBe(200);
    const acceptance = await prisma.riskAcceptance.findFirst({
      where: { organizationId: orgA.id, findingId: finding.id },
    });
    expect(acceptance?.status).toBe("ACCEPTED");
    expect(acceptance?.acceptedBy).toBe(userA.id);
    expect(acceptance?.expiresAt?.toISOString()).toBe("2027-12-01T00:00:00.000Z");

    const reopened = await app.request(path, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ status: "OPEN" }),
    });
    expect(reopened.status).toBe(200);
    const reopenedFinding = await prisma.securityFinding.findUnique({
      where: { id: finding.id },
      select: { status: true, resolvedAt: true, resolutionVerification: true },
    });
    expect(reopenedFinding).toEqual({
      status: "OPEN",
      resolvedAt: null,
      resolutionVerification: "NOT_VERIFIED",
    });
    expect(
      await prisma.riskAcceptance.findFirst({
        where: { organizationId: orgA.id, findingId: finding.id },
        select: { status: true },
      }),
    ).toEqual({ status: "REVOKED" });

    const resolved = await app.request(path, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ status: "RESOLVED" }),
    });
    expect(resolved.status).toBe(200);
    expect(
      await prisma.securityFinding.findUnique({
        where: { id: finding.id },
        select: { status: true, resolutionVerification: true },
      }),
    ).toEqual({ status: "RESOLVED", resolutionVerification: "USER_REPORTED" });
  });

  it("keeps findings and notifications scoped to the verified tenant and user", async () => {
    const finding = await prisma.securityFinding.create({
      data: { organizationId: orgB.id, provider: "test", title: `private-finding-${runId}` },
      select: { id: true },
    });
    const notification = await prisma.notification.create({
      data: {
        organizationId: orgB.id,
        userId: userB.id,
        type: "TEST",
        title: "Private notification",
        body: `private-notification-${runId}`,
      },
      select: { id: true },
    });
    const teammateNotification = await prisma.notification.create({
      data: {
        organizationId: orgA.id,
        userId: viewerA.id,
        type: "TEST",
        title: "Teammate-only notification",
        body: `teammate-notification-${runId}`,
      },
      select: { id: true },
    });
    await prisma.notification.createMany({
      data: [
        {
          organizationId: orgA.id,
          userId: userA.id,
          type: "SECURITY_FINDING_HIGH",
          title: "High finding",
          body: `own-high-notification-${runId}`,
        },
        {
          organizationId: orgA.id,
          userId: userA.id,
          type: "SECURITY_FINDING_CRITICAL",
          title: "Critical finding",
          body: `own-critical-notification-${runId}`,
          createdAt: new Date(Date.now() + 1000),
        },
      ],
    });

    const listing = await app.request(`/api/organizations/${orgA.id}/findings`, {
      headers: authHeader(sessionA),
    });
    expect(listing.status).toBe(200);
    expect(await listing.text()).not.toContain(`private-finding-${runId}`);

    const findingById = await app.request(`/api/organizations/${orgA.id}/findings/${finding.id}`, {
      method: "PATCH",
      headers: { ...authHeader(sessionA), "content-type": "application/json" },
      body: JSON.stringify({ status: "TRIAGED" }),
    });
    expect(findingById.status).toBe(404);

    const inbox = await app.request(`/api/organizations/${orgA.id}/notifications`, {
      headers: authHeader(sessionA),
    });
    expect(inbox.status).toBe(200);
    const inboxBody = await inbox.json();
    expect(JSON.stringify(inboxBody)).not.toContain(`private-notification-${runId}`);
    expect(JSON.stringify(inboxBody)).not.toContain(`teammate-notification-${runId}`);
    expect(inboxBody).toMatchObject({ data: { unreadCount: 2 } });
    const firstPage = await app.request(
      `/api/organizations/${orgA.id}/notifications?category=SECURITY&severity=HIGH&limit=1`,
      { headers: authHeader(sessionA) },
    );
    const firstPageBody = (await firstPage.json()) as {
      data: { items: Array<{ id: string }>; nextCursor: string | null };
    };
    expect(firstPage.status).toBe(200);
    expect(firstPageBody.data.items).toHaveLength(1);
    expect(firstPageBody.data.items[0]).toMatchObject({ type: "SECURITY_FINDING_HIGH" });
    expect(firstPageBody.data.nextCursor).toBeNull();
    const invalidCursor = await app.request(
      `/api/organizations/${orgA.id}/notifications?cursor=${teammateNotification.id}`,
      { headers: authHeader(sessionA) },
    );
    expect(invalidCursor.status).toBe(400);
    const invalidFilter = await app.request(
      `/api/organizations/${orgA.id}/notifications?severity=EXTREME`,
      { headers: authHeader(sessionA) },
    );
    expect(invalidFilter.status).toBe(400);
    const userInbox = await app.request(`/api/organizations/${orgA.id}/notifications`, {
      headers: authHeader(viewerSessionA),
    });
    expect(await userInbox.text()).toContain(`teammate-notification-${runId}`);

    const notificationById = await app.request(
      `/api/organizations/${orgA.id}/notifications/${notification.id}/read`,
      { method: "POST", headers: authHeader(sessionA) },
    );
    expect(notificationById.status).toBe(404);
    const teammateNotificationById = await app.request(
      `/api/organizations/${orgA.id}/notifications/${teammateNotification.id}/read`,
      { method: "POST", headers: authHeader(sessionA) },
    );
    expect(teammateNotificationById.status).toBe(404);
  });

  it("supports organization-scoped notification preferences and read state", async () => {
    const notification = await prisma.notification.create({
      data: {
        organizationId: orgA.id,
        userId: userA.id,
        type: "TEST",
        title: "Read state test",
        body: "A notification for the signed-in user.",
      },
      select: { id: true },
    });
    const preferencePath = `/api/organizations/${orgA.id}/notification-preferences`;
    const update = await app.request(preferencePath, {
      method: "PATCH",
      headers: { ...authHeader(sessionA), "content-type": "application/json" },
      body: JSON.stringify({ emailEnabled: false }),
    });
    expect(update.status).toBe(200);
    expect(await update.json()).toMatchObject({ data: { emailEnabled: false } });

    const categoryUpdate = await app.request(preferencePath, {
      method: "PATCH",
      headers: { ...authHeader(sessionA), "content-type": "application/json" },
      body: JSON.stringify({ securityEmailEnabled: false }),
    });
    expect(categoryUpdate.status).toBe(200);
    expect(await categoryUpdate.json()).toMatchObject({
      data: { emailEnabled: false, securityEmailEnabled: false },
    });
    const crossOrganizationPreferences = await app.request(
      `/api/organizations/${orgB.id}/notification-preferences`,
      { headers: authHeader(sessionB) },
    );
    expect(crossOrganizationPreferences.status).toBe(200);
    expect(await crossOrganizationPreferences.json()).toMatchObject({
      data: {
        emailEnabled: true,
        securityEmailEnabled: true,
        assessmentsEmailEnabled: true,
        governanceEmailEnabled: true,
        integrationsEmailEnabled: true,
        accountEmailEnabled: true,
      },
    });

    const invalid = await app.request(preferencePath, {
      method: "PATCH",
      headers: { ...authHeader(sessionA), "content-type": "application/json" },
      body: JSON.stringify({ emailEnabled: "false" }),
    });
    expect(invalid.status).toBe(400);

    const markedRead = await app.request(
      `/api/organizations/${orgA.id}/notifications/${notification.id}/read`,
      { method: "POST", headers: authHeader(sessionA) },
    );
    expect(markedRead.status).toBe(200);
    const persisted = await prisma.notification.findUnique({
      where: { id: notification.id },
      select: { readAt: true },
    });
    expect(persisted?.readAt).not.toBeNull();

    await prisma.notificationDeliveryAttempt.create({
      data: {
        notificationId: notification.id,
        attempt: 1,
        status: "FAILED",
        errorCode: "PROVIDER_OR_DELIVERY_ERROR",
        latencyMs: 25,
        completedAt: new Date(),
      },
    });
    const forbiddenOperations = await app.request(
      `/api/organizations/${orgA.id}/notification-delivery-operations`,
      { headers: authHeader(viewerSessionA) },
    );
    expect(forbiddenOperations.status).toBe(403);
    const operations = await app.request(
      `/api/organizations/${orgA.id}/notification-delivery-operations`,
      { headers: authHeader(adminSessionA) },
    );
    expect(operations.status).toBe(200);
    const operationsBody = (await operations.json()) as {
      data: {
        statusCounts: Record<string, number>;
        attempts: Array<{ errorCode: string | null; notification: { type: string } }>;
      };
    };
    expect(operationsBody.data.statusCounts["PENDING"]).toBeGreaterThanOrEqual(1);
    expect(
      operationsBody.data.attempts.some(
        (attempt) =>
          attempt.errorCode === "PROVIDER_OR_DELIVERY_ERROR" &&
          attempt.notification.type === "TEST",
      ),
    ).toBe(true);
  });

  it("returns bounded governance trends for an allowed organization", async () => {
    const response = await app.request(
      `/api/organizations/${orgA.id}/governance-analytics?days=7`,
      { headers: authHeader(sessionA) },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        days: number;
        trends: {
          pullRequests: Array<{ day: string; count: number }>;
          reviewsCompleted: Array<{ day: string; count: number }>;
          findingsResolved: Array<{ day: string; count: number }>;
        };
        enabledRepositories: number;
        repositoryAssessmentCoveragePercent: number | null;
        changeAnalysisCoveragePercent: number | null;
        unknownProvenancePullRequests: number;
        policyDecisionsByAction: Record<string, number>;
        failedSecurityGates: number;
        evidenceByStatus: Record<string, number>;
        notificationEmailStatuses: Record<string, number>;
        pullRequestsWithPassports: number;
        passportAvailabilityPercent: number | null;
      };
    };
    expect(body.data.days).toBe(7);
    expect(body.data.trends.pullRequests).toHaveLength(7);
    expect(body.data.trends.reviewsCompleted).toHaveLength(7);
    expect(body.data.trends.findingsResolved).toHaveLength(7);
    expect(body.data.enabledRepositories).toBeGreaterThanOrEqual(0);
    expect(
      body.data.repositoryAssessmentCoveragePercent === null ||
        (body.data.repositoryAssessmentCoveragePercent >= 0 &&
          body.data.repositoryAssessmentCoveragePercent <= 100),
    ).toBe(true);
    expect(
      body.data.changeAnalysisCoveragePercent === null ||
        (body.data.changeAnalysisCoveragePercent >= 0 &&
          body.data.changeAnalysisCoveragePercent <= 100),
    ).toBe(true);
    expect(body.data.unknownProvenancePullRequests).toBeGreaterThanOrEqual(0);
    expect(body.data.failedSecurityGates).toBe(body.data.policyDecisionsByAction["BLOCK"] ?? 0);
    expect(
      body.data.passportAvailabilityPercent === null ||
        (body.data.passportAvailabilityPercent >= 0 &&
          body.data.passportAvailabilityPercent <= 100),
    ).toBe(true);

    const invalidRange = await app.request(
      `/api/organizations/${orgA.id}/governance-analytics?days=365`,
      { headers: authHeader(sessionA) },
    );
    expect(invalidRange.status).toBe(400);

    const exportResponse = await app.request(
      `/api/organizations/${orgA.id}/governance-analytics/export?days=7`,
      { headers: authHeader(viewerSessionA) },
    );
    expect(exportResponse.status).toBe(200);
    expect(exportResponse.headers.get("content-type")).toContain("text/csv");
    expect(exportResponse.headers.get("content-disposition")).toContain("attachment;");
    const csv = await exportResponse.text();
    expect(csv).toContain('"Section","Metric","Date (UTC)","Value"');
    expect(csv).toContain('"Metadata","Reporting period in days","","7"');
    expect(csv).toContain('"Daily trend","Pull requests"');
    expect(csv).toContain('"Policy","Persisted decisions with BLOCK action"');
    expect(csv).toContain('"Change Passport","Pull requests with a passport"');

    const forbiddenExport = await app.request(
      `/api/organizations/${orgB.id}/governance-analytics/export?days=7`,
      { headers: authHeader(sessionA) },
    );
    expect(forbiddenExport.status).toBe(403);
  });

  it("exports a verifiable Change Passport and prevents cross-tenant access", async () => {
    const passport = await prisma.changePassport.create({
      data: {
        organizationId: orgA.id,
        status: "READY",
        summary: "Test passport",
        payload: { change: "test", provenance: "UNKNOWN" },
      },
      select: { id: true, organizationId: true, payload: true },
    });
    const createdAt = new Date();
    const envelope = {
      passportId: passport.id,
      organizationId: orgA.id,
      schemaVersion: 1,
      revision: 1,
      previousHash: null,
      createdAt: createdAt.toISOString(),
      payload: { change: "test", provenance: "UNKNOWN" },
      evidenceSnapshot: { evidence: [{ type: "TEST", status: "PASS" }] },
    };
    const revision = await prisma.changePassportRevision.create({
      data: {
        ...envelope,
        contentHash: hashChangePassportRevision(envelope),
        createdAt,
      },
    });

    const response = await app.request(
      `/api/organizations/${orgA.id}/passports/${passport.id}/export`,
      { headers: authHeader(viewerSessionA) },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("attachment;");
    const body = (await response.json()) as {
      passport: {
        revisions: Array<{ contentHash: string }>;
        recordedEvidenceSnapshot: { evidence: Array<{ type: string; status: string }> };
      };
      unverifiedLiveChange: unknown;
      integrity: {
        status: string;
        checkedRevisions: number;
        algorithm: string;
        unverifiedLiveChangeIncluded: boolean;
        limitation: string;
      };
    };
    expect(body.integrity).toMatchObject({
      algorithm: "SHA-256",
      status: "VERIFIED",
      checkedRevisions: 1,
      unverifiedLiveChangeIncluded: true,
      chainFailure: null,
      currentPayloadMatchesLatestRevision: true,
    });
    expect(body.integrity).toHaveProperty(
      "limitation",
      expect.stringContaining("not compared with that snapshot"),
    );
    expect(body.unverifiedLiveChange).toBeNull();
    expect(body.passport.revisions[0]?.contentHash).toBe(revision.contentHash);
    expect(body.passport.recordedEvidenceSnapshot.evidence).toEqual([
      { type: "TEST", status: "PASS" },
    ]);
    await expect(
      prisma.changePassportRevision.update({
        where: { id: revision.id },
        data: { contentHash: "tampered" },
      }),
    ).rejects.toThrow();

    const crossTenant = await app.request(
      `/api/organizations/${orgB.id}/passports/${passport.id}/export`,
      { headers: authHeader(sessionA) },
    );
    expect(crossTenant.status).toBe(403);
  });

  it("does not expose another organization's assessment report", async () => {
    const assessment = await prisma.assessment.create({
      data: {
        organizationId: orgB.id,
        createdById: userB.id,
        status: "COMPLETED",
        windowStart: new Date("2026-01-01T00:00:00Z"),
        windowEnd: new Date("2026-01-31T23:59:59Z"),
        report: {
          confidential: `org-b-report-${runId}`,
          provenance: [{ evidence: `org-b-provenance-${runId}` }],
        },
        expiresAt: new Date("2027-01-01T00:00:00Z"),
      },
      select: { id: true },
    });

    const response = await app.request(
      `/api/organizations/${orgA.id}/assessments/${assessment.id}`,
      { headers: authHeader(sessionA) },
    );

    expect(response.status).toBe(404);
    const body = (await response.json()) as {
      data: unknown;
      error: { code: string } | null;
    };
    expect(body.error?.code).toBe("NOT_FOUND");
    expect(JSON.stringify(body)).not.toContain(`org-b-report-${runId}`);
    expect(JSON.stringify(body)).not.toContain(`org-b-provenance-${runId}`);
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
    },
  );
});
