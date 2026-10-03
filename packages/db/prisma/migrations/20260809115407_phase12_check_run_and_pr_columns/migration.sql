-- AlterTable
ALTER TABLE "PullRequest" ADD COLUMN     "additions" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "changedFilesCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deletions" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "githubCheckRunId" TEXT,
ADD COLUMN     "headSha" TEXT,
ADD COLUMN     "lastAnalyzedSha" TEXT;

-- CreateIndex
CREATE INDEX "ChangePassport_pullRequestId_idx" ON "ChangePassport"("pullRequestId");
