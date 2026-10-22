ALTER TABLE "Organization"
ADD COLUMN "policyApprovalQuorum" INTEGER NOT NULL DEFAULT 2,
ADD CONSTRAINT "Organization_policyApprovalQuorum_check"
CHECK ("policyApprovalQuorum" BETWEEN 1 AND 5);

CREATE TABLE "PolicyApproval" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyApproval_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PolicyApproval_policyId_version_actorId_key"
ON "PolicyApproval"("policyId", "version", "actorId");

CREATE INDEX "PolicyApproval_organizationId_policyId_version_idx"
ON "PolicyApproval"("organizationId", "policyId", "version");

ALTER TABLE "PolicyApproval"
ADD CONSTRAINT "PolicyApproval_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PolicyApproval"
ADD CONSTRAINT "PolicyApproval_policyId_fkey"
FOREIGN KEY ("policyId") REFERENCES "Policy"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PolicyApproval"
ADD CONSTRAINT "PolicyApproval_actorId_fkey"
FOREIGN KEY ("actorId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
