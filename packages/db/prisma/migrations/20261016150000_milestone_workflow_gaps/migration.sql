ALTER TABLE "SecurityFinding"
ADD COLUMN "resolutionVerification" TEXT NOT NULL DEFAULT 'NOT_VERIFIED';

ALTER TABLE "RiskAcceptance"
ADD COLUMN "expiryWarningNotifiedAt" TIMESTAMP(3);
