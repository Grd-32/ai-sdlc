ALTER TABLE "Session"
ADD COLUMN "authenticationMethod" TEXT NOT NULL DEFAULT 'GITHUB',
ADD COLUMN "identityProviderId" TEXT;

ALTER TABLE "IdentityProvider"
ADD COLUMN "clientSecretEncrypted" TEXT,
ADD COLUMN "ssoTestedAt" TIMESTAMP(3);

CREATE TABLE "FederatedIdentity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "identityProviderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FederatedIdentity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SsoTransaction" (
    "id" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "identityProviderId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "codeVerifier" TEXT,
    "nonce" TEXT,
    "redirectTo" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SsoTransaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SamlRequestCache" (
    "requestId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SamlRequestCache_pkey" PRIMARY KEY ("requestId")
);

CREATE UNIQUE INDEX "FederatedIdentity_identityProviderId_subject_key"
ON "FederatedIdentity"("identityProviderId", "subject");
CREATE INDEX "FederatedIdentity_organizationId_userId_idx"
ON "FederatedIdentity"("organizationId", "userId");
CREATE UNIQUE INDEX "SsoTransaction_stateHash_key" ON "SsoTransaction"("stateHash");
CREATE INDEX "SsoTransaction_expiresAt_idx" ON "SsoTransaction"("expiresAt");
CREATE INDEX "SamlRequestCache_expiresAt_idx" ON "SamlRequestCache"("expiresAt");
CREATE INDEX "Session_identityProviderId_idx" ON "Session"("identityProviderId");

ALTER TABLE "FederatedIdentity"
ADD CONSTRAINT "FederatedIdentity_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FederatedIdentity"
ADD CONSTRAINT "FederatedIdentity_identityProviderId_fkey"
FOREIGN KEY ("identityProviderId") REFERENCES "IdentityProvider"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FederatedIdentity"
ADD CONSTRAINT "FederatedIdentity_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SsoTransaction"
ADD CONSTRAINT "SsoTransaction_identityProviderId_fkey"
FOREIGN KEY ("identityProviderId") REFERENCES "IdentityProvider"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Session"
ADD CONSTRAINT "Session_identityProviderId_fkey"
FOREIGN KEY ("identityProviderId") REFERENCES "IdentityProvider"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
