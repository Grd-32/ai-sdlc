-- Reconstruct legacy schema objects that existed in databases created with
-- prisma db push but were not captured by the original migration history.
CREATE TYPE "AIApprovalStatus" AS ENUM ('APPROVED', 'REVIEW', 'BLOCKED', 'UNREVIEWED');
CREATE TYPE "SBOMComponentStatus" AS ENUM ('ACTIVE', 'REVIEW', 'BLOCKED', 'ACCEPTED');

CREATE TABLE "ServiceAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "role" "OrganizationRole" NOT NULL DEFAULT 'VIEWER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ServiceAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "serviceAccountId" TEXT,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AIProvider" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "AIApprovalStatus" NOT NULL DEFAULT 'UNREVIEWED',
    "website" TEXT,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AIProvider_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AIAgent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "AIApprovalStatus" NOT NULL DEFAULT 'UNREVIEWED',
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AIAgent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AIModel" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT,
    "status" "AIApprovalStatus" NOT NULL DEFAULT 'UNREVIEWED',
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AIModel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SBOMComponent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT,
    "ecosystem" TEXT NOT NULL DEFAULT 'NPM',
    "status" "SBOMComponentStatus" NOT NULL DEFAULT 'ACTIVE',
    "source" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SBOMComponent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RiskAcceptance" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "findingId" TEXT,
    "componentId" TEXT,
    "acceptedBy" TEXT,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACCEPTED',
    "expiresAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RiskAcceptance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ObservabilityEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "service" TEXT,
    "level" TEXT NOT NULL DEFAULT 'INFO',
    "message" TEXT NOT NULL,
    "requestId" TEXT,
    "correlationId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ObservabilityEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ServiceAccount_organizationId_active_idx" ON "ServiceAccount"("organizationId", "active");
CREATE UNIQUE INDEX "ServiceAccount_organizationId_name_key" ON "ServiceAccount"("organizationId", "name");
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");
CREATE INDEX "ApiKey_organizationId_serviceAccountId_idx" ON "ApiKey"("organizationId", "serviceAccountId");
CREATE INDEX "ApiKey_organizationId_revokedAt_expiresAt_idx" ON "ApiKey"("organizationId", "revokedAt", "expiresAt");
CREATE INDEX "AIProvider_organizationId_status_idx" ON "AIProvider"("organizationId", "status");
CREATE UNIQUE INDEX "AIProvider_organizationId_name_key" ON "AIProvider"("organizationId", "name");
CREATE INDEX "AIAgent_organizationId_status_idx" ON "AIAgent"("organizationId", "status");
CREATE UNIQUE INDEX "AIAgent_organizationId_providerId_name_key" ON "AIAgent"("organizationId", "providerId", "name");
CREATE INDEX "AIModel_organizationId_status_idx" ON "AIModel"("organizationId", "status");
CREATE UNIQUE INDEX "AIModel_organizationId_providerId_name_key" ON "AIModel"("organizationId", "providerId", "name");
CREATE INDEX "SBOMComponent_organizationId_status_idx" ON "SBOMComponent"("organizationId", "status");
CREATE UNIQUE INDEX "SBOMComponent_organizationId_ecosystem_name_version_key" ON "SBOMComponent"("organizationId", "ecosystem", "name", "version");
CREATE INDEX "RiskAcceptance_organizationId_status_idx" ON "RiskAcceptance"("organizationId", "status");
CREATE INDEX "ObservabilityEvent_organizationId_createdAt_idx" ON "ObservabilityEvent"("organizationId", "createdAt");
CREATE INDEX "ObservabilityEvent_requestId_idx" ON "ObservabilityEvent"("requestId");
CREATE INDEX "ObservabilityEvent_correlationId_idx" ON "ObservabilityEvent"("correlationId");

ALTER TABLE "ServiceAccount" ADD CONSTRAINT "ServiceAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_serviceAccountId_fkey" FOREIGN KEY ("serviceAccountId") REFERENCES "ServiceAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AIProvider" ADD CONSTRAINT "AIProvider_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AIAgent" ADD CONSTRAINT "AIAgent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AIAgent" ADD CONSTRAINT "AIAgent_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "AIProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AIModel" ADD CONSTRAINT "AIModel_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AIModel" ADD CONSTRAINT "AIModel_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "AIProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SBOMComponent" ADD CONSTRAINT "SBOMComponent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RiskAcceptance" ADD CONSTRAINT "RiskAcceptance_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RiskAcceptance" ADD CONSTRAINT "RiskAcceptance_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "SecurityFinding"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RiskAcceptance" ADD CONSTRAINT "RiskAcceptance_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "SBOMComponent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ObservabilityEvent" ADD CONSTRAINT "ObservabilityEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
