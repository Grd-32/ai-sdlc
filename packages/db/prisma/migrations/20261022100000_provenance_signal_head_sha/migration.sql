ALTER TABLE "ProvenanceSignal"
ADD COLUMN "headSha" TEXT;

CREATE INDEX "ProvenanceSignal_pullRequestId_headSha_idx"
ON "ProvenanceSignal"("pullRequestId", "headSha");
