ALTER TABLE "SecurityFinding"
ADD COLUMN "assigneeId" TEXT,
ADD COLUMN "dueAt" TIMESTAMP(3),
ADD COLUMN "resolvedAt" TIMESTAMP(3),
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Review"
ADD COLUMN "completedAt" TIMESTAMP(3);

CREATE INDEX "Review_organizationId_completedAt_idx"
ON "Review"("organizationId", "completedAt");

CREATE INDEX "SecurityFinding_organizationId_status_dueAt_idx"
ON "SecurityFinding"("organizationId", "status", "dueAt");

CREATE INDEX "SecurityFinding_organizationId_assigneeId_status_idx"
ON "SecurityFinding"("organizationId", "assigneeId", "status");

ALTER TABLE "SecurityFinding"
ADD CONSTRAINT "SecurityFinding_assigneeId_fkey"
FOREIGN KEY ("assigneeId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "FindingActivity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "actorId" TEXT,
    "type" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FindingActivity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FindingActivity_organizationId_findingId_createdAt_idx"
ON "FindingActivity"("organizationId", "findingId", "createdAt");

ALTER TABLE "FindingActivity"
ADD CONSTRAINT "FindingActivity_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FindingActivity"
ADD CONSTRAINT "FindingActivity_findingId_fkey"
FOREIGN KEY ("findingId") REFERENCES "SecurityFinding"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FindingActivity"
ADD CONSTRAINT "FindingActivity_actorId_fkey"
FOREIGN KEY ("actorId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "dedupeKey" TEXT,
    "readAt" TIMESTAMP(3),
    "emailStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key"
ON "Notification"("userId", "dedupeKey");

CREATE INDEX "Notification_userId_readAt_createdAt_idx"
ON "Notification"("userId", "readAt", "createdAt");

CREATE INDEX "Notification_organizationId_type_createdAt_idx"
ON "Notification"("organizationId", "type", "createdAt");

ALTER TABLE "Notification"
ADD CONSTRAINT "Notification_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Notification"
ADD CONSTRAINT "Notification_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationPreference_organizationId_userId_key"
ON "NotificationPreference"("organizationId", "userId");

ALTER TABLE "NotificationPreference"
ADD CONSTRAINT "NotificationPreference_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationPreference"
ADD CONSTRAINT "NotificationPreference_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
