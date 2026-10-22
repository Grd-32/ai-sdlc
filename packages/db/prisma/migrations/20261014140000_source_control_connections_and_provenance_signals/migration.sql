CREATE TYPE "SourceControlProvider" AS ENUM (
  'GITHUB',
  'GITLAB',
  'BITBUCKET',
  'AZURE_DEVOPS'
);

CREATE TYPE "ProvenanceClassification" AS ENUM (
  'DECLARED',
  'OBSERVED',
  'INFERRED',
  'UNKNOWN'
);

CREATE TYPE "ProvenanceVerificationStatus" AS ENUM (
  'VERIFIED',
  'UNVERIFIED',
  'FAILED',
  'NOT_APPLICABLE'
);

CREATE TABLE "SourceControlConnection" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "provider" "SourceControlProvider" NOT NULL,
  "externalAccountId" TEXT NOT NULL,
  "accountName" TEXT NOT NULL,
  "credentialCiphertext" TEXT NOT NULL,
  "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "capabilities" JSONB,
  "webhookSecretHash" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "lastCheckedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SourceControlConnection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SourceControlConnection_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SourceControlConnection_organizationId_provider_externalAccountId_key"
  ON "SourceControlConnection"("organizationId", "provider", "externalAccountId");
CREATE INDEX "SourceControlConnection_organizationId_provider_active_idx"
  ON "SourceControlConnection"("organizationId", "provider", "active");

ALTER TABLE "Repository"
  ADD COLUMN "sourceControlConnectionId" TEXT;
ALTER TABLE "Repository"
  ADD CONSTRAINT "Repository_sourceControlConnectionId_fkey"
  FOREIGN KEY ("sourceControlConnectionId") REFERENCES "SourceControlConnection"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Repository_sourceControlConnectionId_idx"
  ON "Repository"("sourceControlConnectionId");

CREATE TABLE "ProvenanceSignal" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "repositoryId" TEXT,
  "pullRequestId" TEXT,
  "provider" TEXT,
  "signalSource" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "signalType" TEXT NOT NULL,
  "classification" "ProvenanceClassification" NOT NULL,
  "verificationStatus" "ProvenanceVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
  "evidenceReference" TEXT,
  "evidenceAt" TIMESTAMP(3),
  "confidence" DOUBLE PRECISION,
  "limitations" TEXT,
  "signalKey" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProvenanceSignal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProvenanceSignal_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProvenanceSignal_pullRequestId_fkey"
    FOREIGN KEY ("pullRequestId") REFERENCES "PullRequest"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ProvenanceSignal_organizationId_signalKey_key"
  ON "ProvenanceSignal"("organizationId", "signalKey");
CREATE INDEX "ProvenanceSignal_organizationId_classification_evidenceAt_idx"
  ON "ProvenanceSignal"("organizationId", "classification", "evidenceAt");
CREATE INDEX "ProvenanceSignal_organizationId_repositoryId_pullRequestId_idx"
  ON "ProvenanceSignal"("organizationId", "repositoryId", "pullRequestId");
