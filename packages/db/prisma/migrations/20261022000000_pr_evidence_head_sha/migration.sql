ALTER TABLE "Evidence"
ADD COLUMN "headSha" TEXT;

CREATE INDEX "Evidence_pullRequestId_headSha_idx"
ON "Evidence"("pullRequestId", "headSha");
