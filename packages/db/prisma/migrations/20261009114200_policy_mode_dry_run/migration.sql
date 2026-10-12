-- Policy modes: default to safe dry-run execution before enforcement

-- CreateEnum
CREATE TYPE "PolicyMode" AS ENUM ('ENFORCING', 'DRY_RUN', 'DISABLED');

-- AlterTable Policy
ALTER TABLE "Policy"
  ADD COLUMN "mode" "PolicyMode" NOT NULL DEFAULT 'DRY_RUN';

CREATE INDEX "Policy_organizationId_mode_idx"
  ON "Policy"("organizationId", "mode");
