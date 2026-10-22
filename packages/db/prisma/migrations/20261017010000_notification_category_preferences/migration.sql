ALTER TABLE "NotificationPreference"
ADD COLUMN "securityEmailEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "assessmentsEmailEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "governanceEmailEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "integrationsEmailEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "accountEmailEnabled" BOOLEAN NOT NULL DEFAULT true;
