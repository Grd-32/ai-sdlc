CREATE TABLE "PolicyRevision" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "policyId" TEXT,
    "version" TEXT NOT NULL,
    "actorId" TEXT,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PolicyRevision_policyId_version_key"
ON "PolicyRevision"("policyId", "version");

CREATE INDEX "PolicyRevision_organizationId_createdAt_idx"
ON "PolicyRevision"("organizationId", "createdAt");

ALTER TABLE "PolicyRevision"
ADD CONSTRAINT "PolicyRevision_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PolicyRevision"
ADD CONSTRAINT "PolicyRevision_policyId_fkey"
FOREIGN KEY ("policyId") REFERENCES "Policy"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "PolicyRevision" (
    "id",
    "organizationId",
    "policyId",
    "version",
    "snapshot"
)
SELECT
    'policy-revision-bootstrap-' || policy."id",
    policy."organizationId",
    policy."id",
    policy."version",
    jsonb_build_object(
        'id', policy."id",
        'name', policy."name",
        'description', policy."description",
        'enabled', policy."enabled",
        'mode', policy."mode",
        'version', policy."version",
        'metadata', policy."metadata",
        'policyRules', COALESCE((
            SELECT jsonb_agg(
                jsonb_build_object(
                    'id', rule."id",
                    'name', rule."name",
                    'aiInvolved', rule."aiInvolved",
                    'conditionExpression', rule."conditionExpression",
                    'sensitiveAreas', rule."sensitiveAreas",
                    'riskAtLeast', rule."riskAtLeast",
                    'repositoryCriticalityIn', rule."repositoryCriticalityIn",
                    'action', rule."action",
                    'requiredApprovals', rule."requiredApprovals",
                    'reason', rule."reason",
                    'precedence', rule."precedence"
                )
                ORDER BY rule."precedence" DESC, rule."id"
            )
            FROM "PolicyRule" rule
            WHERE rule."policyId" = policy."id"
        ), '[]'::jsonb)
    )
FROM "Policy" policy;
