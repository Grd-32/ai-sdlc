ALTER TABLE "OrganizationDeletionRequest"
  ADD COLUMN "organizationSlug" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "approvedById" TEXT,
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "failureReason" TEXT;

UPDATE "OrganizationDeletionRequest" AS request
SET "organizationSlug" = organization."slug"
FROM "Organization" AS organization
WHERE request."organizationId" = organization."id";

ALTER TABLE "OrganizationDeletionRequest"
  ALTER COLUMN "organizationSlug" DROP DEFAULT;

ALTER TABLE "OrganizationDeletionRequest"
  ALTER COLUMN "organizationId" DROP NOT NULL;

ALTER TABLE "OrganizationMember"
  ADD COLUMN "scimManagedRole" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "OrganizationDeletionRequest"
  DROP CONSTRAINT IF EXISTS "OrganizationDeletionRequest_organizationId_fkey",
  ADD CONSTRAINT "OrganizationDeletionRequest_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "OrganizationInvitation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'VIEWER',
  "tokenHash" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "acceptedById" TEXT,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrganizationInvitation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrganizationInvitation_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OrganizationInvitation_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OrganizationInvitation_acceptedById_fkey"
    FOREIGN KEY ("acceptedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OrganizationInvitation_tokenHash_key"
  ON "OrganizationInvitation"("tokenHash");
CREATE INDEX "OrganizationInvitation_organizationId_email_acceptedAt_revokedAt_idx"
  ON "OrganizationInvitation"("organizationId", "email", "acceptedAt", "revokedAt");
CREATE INDEX "OrganizationInvitation_expiresAt_idx"
  ON "OrganizationInvitation"("expiresAt");

ALTER TABLE "Notification"
  ADD COLUMN "invitationId" TEXT;
ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_invitationId_fkey"
    FOREIGN KEY ("invitationId") REFERENCES "OrganizationInvitation"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Notification_invitationId_idx"
  ON "Notification"("invitationId");

CREATE TABLE "ScimGroup" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "role" "OrganizationRole" NOT NULL DEFAULT 'VIEWER',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ScimGroup_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ScimGroup_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ScimGroup_organizationId_externalId_key"
  ON "ScimGroup"("organizationId", "externalId");
CREATE INDEX "ScimGroup_organizationId_displayName_idx"
  ON "ScimGroup"("organizationId", "displayName");

CREATE TABLE "ScimGroupMember" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ScimGroupMember_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ScimGroupMember_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "ScimGroup"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ScimGroupMember_memberId_fkey"
    FOREIGN KEY ("memberId") REFERENCES "OrganizationMember"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ScimGroupMember_groupId_memberId_key"
  ON "ScimGroupMember"("groupId", "memberId");
CREATE INDEX "ScimGroupMember_memberId_idx"
  ON "ScimGroupMember"("memberId");

CREATE TABLE "FindingResolutionEvidence" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "securityFindingId" TEXT,
  "provider" TEXT NOT NULL,
  "providerFindingId" TEXT NOT NULL,
  "providerState" TEXT NOT NULL,
  "commitSha" TEXT,
  "externalRef" TEXT,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB,
  CONSTRAINT "FindingResolutionEvidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FindingResolutionEvidence_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FindingResolutionEvidence_securityFindingId_fkey"
    FOREIGN KEY ("securityFindingId") REFERENCES "SecurityFinding"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "FindingResolutionEvidence_organizationId_provider_providerFindingId_observedAt_idx"
  ON "FindingResolutionEvidence"("organizationId", "provider", "providerFindingId", "observedAt");
CREATE INDEX "FindingResolutionEvidence_securityFindingId_observedAt_idx"
  ON "FindingResolutionEvidence"("securityFindingId", "observedAt");
