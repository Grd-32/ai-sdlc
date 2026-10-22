ALTER TABLE "Review"
  ALTER COLUMN "decision" DROP NOT NULL,
  ADD COLUMN "reviewedHeadSha" TEXT,
  ADD COLUMN "requirement" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "reviewerRole" "OrganizationRole";

CREATE UNIQUE INDEX "Review_pullRequestId_reviewerId_reviewedHeadSha_requirement_key"
  ON "Review"("pullRequestId", "reviewerId", "reviewedHeadSha", "requirement");

CREATE INDEX "Review_pullRequestId_reviewedHeadSha_status_idx"
  ON "Review"("pullRequestId", "reviewedHeadSha", "status");
