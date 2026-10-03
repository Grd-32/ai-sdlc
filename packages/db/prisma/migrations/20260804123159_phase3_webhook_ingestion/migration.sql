-- CreateTable
CREATE TABLE "GitHubWebhookEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "installationId" TEXT,
    "repositoryId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'GITHUB',
    "eventType" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "GitHubWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GitHubWebhookEvent_provider_eventType_createdAt_idx" ON "GitHubWebhookEvent"("provider", "eventType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GitHubWebhookEvent_provider_deliveryId_key" ON "GitHubWebhookEvent"("provider", "deliveryId");

-- AddForeignKey
ALTER TABLE "GitHubWebhookEvent" ADD CONSTRAINT "GitHubWebhookEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitHubWebhookEvent" ADD CONSTRAINT "GitHubWebhookEvent_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "GitHubInstallation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitHubWebhookEvent" ADD CONSTRAINT "GitHubWebhookEvent_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE SET NULL ON UPDATE CASCADE;
