CREATE TYPE "CommercialPlan" AS ENUM ('FREE_ASSESSMENT', 'PROFESSIONAL', 'ENTERPRISE');
CREATE TYPE "BillingSubscriptionStatus" AS ENUM (
  'INCOMPLETE',
  'ACTIVE',
  'TRIALING',
  'PAST_DUE',
  'UNPAID',
  'CANCELED',
  'INACTIVE'
);
CREATE TYPE "BillingProvider" AS ENUM ('STRIPE', 'MANUAL');
CREATE TYPE "BillableUsageType" AS ENUM (
  'ASSESSMENT_ATTEMPT',
  'ASSESSMENT_COMPLETED',
  'ANALYSIS_JOB'
);

CREATE TABLE "BillingSubscription" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "plan" "CommercialPlan" NOT NULL DEFAULT 'FREE_ASSESSMENT',
  "status" "BillingSubscriptionStatus" NOT NULL DEFAULT 'INACTIVE',
  "provider" "BillingProvider",
  "providerCustomerId" TEXT,
  "providerSubscriptionId" TEXT,
  "providerPriceId" TEXT,
  "currentPeriodStart" TIMESTAMP(3),
  "currentPeriodEnd" TIMESTAMP(3),
  "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
  "latestInvoiceStatus" TEXT,
  "agreementName" TEXT,
  "entitlements" JSONB,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BillingSubscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BillingInvoice" (
  "id" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "providerInvoiceId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "amountDue" INTEGER,
  "amountPaid" INTEGER,
  "currency" TEXT,
  "hostedInvoiceUrl" TEXT,
  "periodStart" TIMESTAMP(3),
  "periodEnd" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BillingInvoice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BillingWebhookEvent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT,
  "providerEventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RECEIVED',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BillingWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UsageRecord" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "type" "BillableUsageType" NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "idempotencyKey" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BillingSubscription_organizationId_key" ON "BillingSubscription"("organizationId");
CREATE UNIQUE INDEX "BillingSubscription_providerCustomerId_key" ON "BillingSubscription"("providerCustomerId");
CREATE UNIQUE INDEX "BillingSubscription_providerSubscriptionId_key" ON "BillingSubscription"("providerSubscriptionId");
CREATE INDEX "BillingSubscription_plan_status_idx" ON "BillingSubscription"("plan", "status");
CREATE INDEX "BillingSubscription_providerSubscriptionId_idx" ON "BillingSubscription"("providerSubscriptionId");
CREATE UNIQUE INDEX "BillingInvoice_providerInvoiceId_key" ON "BillingInvoice"("providerInvoiceId");
CREATE INDEX "BillingInvoice_subscriptionId_createdAt_idx" ON "BillingInvoice"("subscriptionId", "createdAt");
CREATE INDEX "BillingInvoice_status_idx" ON "BillingInvoice"("status");
CREATE UNIQUE INDEX "BillingWebhookEvent_providerEventId_key" ON "BillingWebhookEvent"("providerEventId");
CREATE INDEX "BillingWebhookEvent_status_createdAt_idx" ON "BillingWebhookEvent"("status", "createdAt");
CREATE INDEX "BillingWebhookEvent_organizationId_createdAt_idx" ON "BillingWebhookEvent"("organizationId", "createdAt");
CREATE UNIQUE INDEX "UsageRecord_organizationId_idempotencyKey_key" ON "UsageRecord"("organizationId", "idempotencyKey");
CREATE INDEX "UsageRecord_organizationId_type_createdAt_idx" ON "UsageRecord"("organizationId", "type", "createdAt");

ALTER TABLE "BillingSubscription"
  ADD CONSTRAINT "BillingSubscription_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingInvoice"
  ADD CONSTRAINT "BillingInvoice_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "BillingSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingWebhookEvent"
  ADD CONSTRAINT "BillingWebhookEvent_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UsageRecord"
  ADD CONSTRAINT "UsageRecord_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
