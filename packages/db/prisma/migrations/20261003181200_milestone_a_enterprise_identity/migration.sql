-- Milestone A: enterprise identity, sessions, SCIM, SSO foundations

-- CreateEnum
CREATE TYPE "IdentityProviderType" AS ENUM ('OIDC', 'SAML');
CREATE TYPE "OrganizationEnvironment" AS ENUM ('PRODUCTION', 'STAGING', 'DEVELOPMENT');

-- AlterEnum (add new organization roles)
ALTER TYPE "OrganizationRole" ADD VALUE 'SECURITY_ADMIN';
ALTER TYPE "OrganizationRole" ADD VALUE 'SECURITY_ANALYST';
ALTER TYPE "OrganizationRole" ADD VALUE 'REVIEWER';

-- AlterTable Organization
ALTER TABLE "Organization" ADD COLUMN "ssoEnforced" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable User
ALTER TABLE "User" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "externalId" TEXT;

-- AlterTable OrganizationMember (SCIM provisioning)
ALTER TABLE "OrganizationMember" ADD COLUMN "externalId" TEXT;
ALTER TABLE "OrganizationMember" ADD COLUMN "scimActive" BOOLEAN NOT NULL DEFAULT true;
CREATE UNIQUE INDEX "OrganizationMember_organizationId_externalId_key" ON "OrganizationMember"("organizationId", "externalId");

-- CreateTable Session
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable IdentityProvider
CREATE TABLE "IdentityProvider" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "IdentityProviderType" NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "issuer" TEXT,
    "clientId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "IdentityProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable ScimBearerToken
CREATE TABLE "ScimBearerToken" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScimBearerToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable OrganizationDomain
CREATE TABLE "OrganizationDomain" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verificationToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrganizationDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable OrganizationEnvironmentConfig
CREATE TABLE "OrganizationEnvironmentConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "environment" "OrganizationEnvironment" NOT NULL DEFAULT 'DEVELOPMENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrganizationEnvironmentConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");

CREATE INDEX "IdentityProvider_organizationId_enabled_idx" ON "IdentityProvider"("organizationId", "enabled");

CREATE UNIQUE INDEX "ScimBearerToken_tokenHash_key" ON "ScimBearerToken"("tokenHash");
CREATE INDEX "ScimBearerToken_organizationId_idx" ON "ScimBearerToken"("organizationId");

CREATE UNIQUE INDEX "OrganizationDomain_organizationId_domain_key" ON "OrganizationDomain"("organizationId", "domain");
CREATE INDEX "OrganizationDomain_domain_idx" ON "OrganizationDomain"("domain");

CREATE UNIQUE INDEX "OrganizationEnvironmentConfig_organizationId_slug_key" ON "OrganizationEnvironmentConfig"("organizationId", "slug");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IdentityProvider" ADD CONSTRAINT "IdentityProvider_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScimBearerToken" ADD CONSTRAINT "ScimBearerToken_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationDomain" ADD CONSTRAINT "OrganizationDomain_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationEnvironmentConfig" ADD CONSTRAINT "OrganizationEnvironmentConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
