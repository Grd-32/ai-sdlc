CREATE TYPE "AssessmentStatus" AS ENUM (
  'CREATED',
  'AUTHORIZATION_PENDING',
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'COMPLETED_WITH_LIMITATIONS',
  'FAILED',
  'CANCELLED'
);

CREATE TABLE "Assessment" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "status" "AssessmentStatus" NOT NULL DEFAULT 'CREATED',
  "windowStart" TIMESTAMP(3) NOT NULL,
  "windowEnd" TIMESTAMP(3) NOT NULL,
  "progress" INTEGER NOT NULL DEFAULT 0,
  "totalPullRequests" INTEGER NOT NULL DEFAULT 0,
  "processedPullRequests" INTEGER NOT NULL DEFAULT 0,
  "report" JSONB,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "idempotencyKey" TEXT,
  "permissionsSnapshot" JSONB,
  "queuedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Assessment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssessmentRepository" (
  "assessmentId" TEXT NOT NULL,
  "repositoryId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssessmentRepository_pkey" PRIMARY KEY ("assessmentId", "repositoryId")
);

CREATE UNIQUE INDEX "Assessment_organizationId_createdById_idempotencyKey_key"
  ON "Assessment"("organizationId", "createdById", "idempotencyKey");
CREATE INDEX "Assessment_organizationId_createdAt_idx"
  ON "Assessment"("organizationId", "createdAt");
CREATE INDEX "Assessment_status_queuedAt_idx"
  ON "Assessment"("status", "queuedAt");
CREATE INDEX "AssessmentRepository_repositoryId_idx"
  ON "AssessmentRepository"("repositoryId");

ALTER TABLE "Assessment"
  ADD CONSTRAINT "Assessment_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Assessment"
  ADD CONSTRAINT "Assessment_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssessmentRepository"
  ADD CONSTRAINT "AssessmentRepository_assessmentId_fkey"
  FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssessmentRepository"
  ADD CONSTRAINT "AssessmentRepository_repositoryId_fkey"
  FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
