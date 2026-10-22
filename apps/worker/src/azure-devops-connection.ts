import { prisma } from "@ai-sdlc/db";
import {
  AzureDevOpsClient,
  decryptSourceControlCredentials,
  encryptSourceControlCredentials,
  refreshAzureDevOpsOAuthToken,
  SourceControlProviderError,
} from "@ai-sdlc/source-control";

const REQUIRED_SCOPES = ["vso.project", "vso.code"];

export interface AzureDevOpsConnectionCredentials {
  id: string;
  organizationId: string;
  active: boolean;
  credentialCiphertext: string;
  scopes: string[];
  accountName: string;
}

function assertRequiredScopes(scopes: string[]): void {
  if (REQUIRED_SCOPES.some((scope) => !scopes.includes(scope))) {
    throw new SourceControlProviderError(
      "Azure DevOps authorization is missing required read-only scopes.",
      "PERMISSION",
    );
  }
}

export async function createAzureDevOpsClient(
  connection: AzureDevOpsConnectionCredentials,
): Promise<AzureDevOpsClient> {
  if (!connection.active) {
    throw new SourceControlProviderError(
      "Azure DevOps connection is disconnected.",
      "AUTHENTICATION",
    );
  }
  assertRequiredScopes(connection.scopes);
  let credentials = decryptSourceControlCredentials(connection.credentialCiphertext);
  if (Date.parse(credentials.expiresAt) <= Date.now() + 5 * 60 * 1000) {
    const clientId = process.env["AZURE_DEVOPS_OAUTH_CLIENT_ID"];
    const clientSecret = process.env["AZURE_DEVOPS_OAUTH_CLIENT_SECRET"];
    const tenantId = process.env["AZURE_DEVOPS_TENANT_ID"] ?? "organizations";
    if (!clientId || !clientSecret) {
      throw new SourceControlProviderError(
        "Azure DevOps OAuth is not configured for token refresh.",
        "UNAVAILABLE",
      );
    }
    try {
      const refreshed = await refreshAzureDevOpsOAuthToken({
        clientId,
        clientSecret,
        tenantId,
        refreshToken: credentials.refreshToken,
      });
      assertRequiredScopes(refreshed.scope);
      const nextCredentials = {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString(),
      };
      const updated = await prisma.sourceControlConnection.updateMany({
        where: {
          id: connection.id,
          organizationId: connection.organizationId,
          provider: "AZURE_DEVOPS",
          active: true,
          credentialCiphertext: connection.credentialCiphertext,
        },
        data: {
          credentialCiphertext: encryptSourceControlCredentials(nextCredentials),
          scopes: refreshed.scope,
        },
      });
      if (updated.count === 1) {
        credentials = nextCredentials;
      } else {
        const latest = await prisma.sourceControlConnection.findFirst({
          where: {
            id: connection.id,
            organizationId: connection.organizationId,
            provider: "AZURE_DEVOPS",
            active: true,
          },
          select: { credentialCiphertext: true, scopes: true },
        });
        if (!latest) {
          throw new SourceControlProviderError(
            "Azure DevOps connection was disconnected during token refresh.",
            "AUTHENTICATION",
          );
        }
        assertRequiredScopes(latest.scopes);
        credentials = decryptSourceControlCredentials(latest.credentialCiphertext);
        if (Date.parse(credentials.expiresAt) <= Date.now()) {
          throw new SourceControlProviderError(
            "Azure DevOps token refresh did not produce an active credential.",
            "AUTHENTICATION",
          );
        }
      }
    } catch (error) {
      if (error instanceof SourceControlProviderError) throw error;
      throw new SourceControlProviderError(
        "Azure DevOps credential refresh failed.",
        "UNAVAILABLE",
      );
    }
  }
  return new AzureDevOpsClient({
    accessToken: credentials.accessToken,
    organization: connection.accountName,
  });
}
