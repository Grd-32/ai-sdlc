ALTER TABLE "ProvenanceSignal"
  ADD CONSTRAINT "ProvenanceSignal_repositoryId_fkey"
  FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
