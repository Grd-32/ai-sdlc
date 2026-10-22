CREATE TABLE "OrganizationDeletionRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestedById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "OrganizationDeletionRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrganizationDeletionRequest_organizationId_status_idx"
ON "OrganizationDeletionRequest"("organizationId", "status");

ALTER TABLE "OrganizationDeletionRequest"
ADD CONSTRAINT "OrganizationDeletionRequest_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrganizationDeletionRequest"
ADD CONSTRAINT "OrganizationDeletionRequest_requestedById_fkey"
FOREIGN KEY ("requestedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
