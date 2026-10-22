import type { Hono } from "hono";
import {
  canonicalJson,
  prisma,
  recordAuditEvent,
  verifyChangePassportRevisionChain,
} from "@ai-sdlc/db";
import { requireAuth, requireOrganizationRole } from "../middleware/auth.js";
import type { AppEnv } from "../types.js";

export function registerPassportRoutes(app: Hono<AppEnv>): void {
  app.get(
    "/api/organizations/:organizationId/passports/:passportId/export",
    requireAuth,
    requireOrganizationRole("VIEWER"),
    async (c) => {
      const organizationId = c.get("organizationId");
      const passport = await prisma.changePassport.findFirst({
        where: {
          id: c.req.param("passportId"),
          organizationId,
        },
        include: {
          revisions: {
            orderBy: { revision: "asc" },
            select: {
              passportId: true,
              organizationId: true,
              schemaVersion: true,
              revision: true,
              payload: true,
              evidenceSnapshot: true,
              previousHash: true,
              contentHash: true,
              createdAt: true,
            },
          },
          pullRequest: {
            select: {
              id: true,
              provider: true,
              externalId: true,
              number: true,
              title: true,
              headSha: true,
              sourceBranch: true,
              targetBranch: true,
              repository: { select: { provider: true, owner: true, name: true } },
              commits: {
                orderBy: { committedAt: "asc" },
                select: { sha: true, committedAt: true },
              },
              aiActivities: {
                orderBy: { createdAt: "desc" },
                take: 1,
                select: { involvement: true, source: true, confidence: true, createdAt: true },
              },
              riskAssessments: {
                orderBy: { createdAt: "desc" },
                take: 1,
                select: { level: true, score: true, modelVersion: true, createdAt: true },
              },
              policyDecisions: {
                orderBy: { createdAt: "desc" },
                take: 1,
                select: { action: true, matchedRuleIds: true, createdAt: true },
              },
              reviews: {
                orderBy: { createdAt: "asc" },
                select: { status: true, decision: true, reviewedHeadSha: true, createdAt: true },
              },
              evidence: {
                orderBy: { createdAt: "asc" },
                select: {
                  id: true,
                  type: true,
                  status: true,
                  source: true,
                  externalRef: true,
                  createdAt: true,
                },
              },
              findings: {
                orderBy: { createdAt: "asc" },
                select: {
                  id: true,
                  provider: true,
                  category: true,
                  severity: true,
                  status: true,
                  createdAt: true,
                },
              },
            },
          },
        },
      });
      if (!passport) {
        return c.json(
          { data: null, error: { code: "NOT_FOUND", message: "Change Passport not found" } },
          404,
        );
      }
      const revisions = passport.revisions.map((revision) => ({
        passportId: revision.passportId,
        organizationId: revision.organizationId,
        schemaVersion: revision.schemaVersion,
        revision: revision.revision,
        payload: revision.payload,
        evidenceSnapshot: revision.evidenceSnapshot,
        previousHash: revision.previousHash,
        contentHash: revision.contentHash,
        createdAt: revision.createdAt.toISOString(),
      }));
      const chain = verifyChangePassportRevisionChain(revisions);
      const latestRevision = revisions.at(-1);
      const currentPayloadMatchesLatestRevision =
        latestRevision !== undefined &&
        canonicalJson(passport.payload) === canonicalJson(latestRevision.payload);
      const integrityStatus =
        revisions.length === 0
          ? "NO_REVISION_HISTORY"
          : chain.valid && currentPayloadMatchesLatestRevision
            ? "VERIFIED"
            : "FAILED";
      await recordAuditEvent({
        organizationId,
        actorId: c.get("userId"),
        eventType: "CHANGE_PASSPORT_EXPORTED",
        metadata: {
          passportId: passport.id,
          revisionCount: passport.revisions.length,
          integrityStatus,
        },
      });
      const exportData = {
        exportFormat: "nomalog-change-passport-v1",
        exportedAt: new Date().toISOString(),
        passport: {
          id: passport.id,
          organizationId: passport.organizationId,
          status: passport.status,
          summary: passport.summary,
          payload: passport.payload,
          recordedEvidenceSnapshot: latestRevision?.evidenceSnapshot ?? null,
          createdAt: passport.createdAt,
          updatedAt: passport.updatedAt,
          revisions,
        },
        unverifiedLiveChange: passport.pullRequest,
        integrity: {
          algorithm: "SHA-256",
          status: integrityStatus,
          checkedRevisions: chain.checked,
          chainFailure: chain.reason,
          currentPayloadMatchesLatestRevision,
          unverifiedLiveChangeIncluded: true,
          limitation:
            "The hash chain covers each revision's passport payload and persisted evidence snapshot. The separately included live change relation is not compared with that snapshot or covered by the chain. This is not a digital signature and does not protect against a database owner who can bypass or remove database triggers.",
        },
      };

      c.header("Content-Type", "application/json; charset=utf-8");
      c.header(
        "Content-Disposition",
        `attachment; filename="nomalog-change-passport-${passport.id}.json"`,
      );
      c.header("Cache-Control", "private, no-store");
      return c.body(`${JSON.stringify(exportData, null, 2)}\n`);
    },
  );
}
