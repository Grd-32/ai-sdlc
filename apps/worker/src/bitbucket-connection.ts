import { prisma } from "@ai-sdlc/db";
import {
  BitbucketClient,
  decryptSourceControlCredentials,
  encryptSourceControlCredentials,
  refreshBitbucketOAuthToken,
  SourceControlProviderError,
} from "@ai-sdlc/source-control";

const REQUIRED_SCOPES = ["account", "repository", "pullrequest"];

export interface BitbucketConnectionCredentials {
  id: string;
  organizationId: string;
  active: boolean;
  credentialCiphertext: string;
  scopes: string[];
}

function assertRequiredScopes(scopes: string[]): void {
  if (REQUIRED_SCOPES.some((scope) => !scopes.includes(scope))) {
    throw new SourceControlProviderError(
      "Bitbucket authorization is missing required read-only scopes.",
      "PERMISSION",
    );
  }
}

export async function createBitbucketClient(
  connection: BitbucketConnectionCredentials,
): Promise<BitbucketClient> {
  if (!connection.active) {
    throw new SourceControlProviderError("Bitbucket connection is disconnected.", "AUTHENTICATION");
  }
  assertRequiredScopes(connection.scopes);
  let credentials = decryptSourceControlCredentials(connection.credentialCiphertext);
  if (Date.parse(credentials.expiresAt) <= Date.now() + 5 * 60 * 1000) {
    const clientId = process.env["BITBUCKET_OAUTH_CLIENT_ID"];
    const clientSecret = process.env["BITBUCKET_OAUTH_CLIENT_SECRET"];
    if (!clientId || !clientSecret) {
      throw new SourceControlProviderError(
        "Bitbucket OAuth is not configured for token refresh.",
        "UNAVAILABLE",
      );
    }
    try {
      const refreshed = await refreshBitbucketOAuthToken({
        clientId,
        clientSecret,
        refreshToken: credentials.refreshToken,
      });
      assertRequiredScopes(refreshed.scopes);
      const nextCredentials = {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString(),
      };
      const updated = await prisma.sourceControlConnection.updateMany({
        where: {
          id: connection.id,
          organizationId: connection.organizationId,
          provider: "BITBUCKET",
          active: true,
          credentialCiphertext: connection.credentialCiphertext,
        },
        data: {
          credentialCiphertext: encryptSourceControlCredentials(nextCredentials),
          scopes: refreshed.scopes,
        },
      });
      if (updated.count === 1) {
        credentials = nextCredentials;
      } else {
        const latest = await prisma.sourceControlConnection.findFirst({
          where: {
            id: connection.id,
            organizationId: connection.organizationId,
            provider: "BITBUCKET",
            active: true,
          },
          select: { credentialCiphertext: true, scopes: true },
        });
        if (!latest) {
          throw new SourceControlProviderError(
            "Bitbucket connection was disconnected during token refresh.",
            "AUTHENTICATION",
          );
        }
        assertRequiredScopes(latest.scopes);
        credentials = decryptSourceControlCredentials(latest.credentialCiphertext);
        if (Date.parse(credentials.expiresAt) <= Date.now()) {
          throw new SourceControlProviderError(
            "Bitbucket token refresh did not produce an active credential.",
            "AUTHENTICATION",
          );
        }
      }
    } catch (error) {
      if (error instanceof SourceControlProviderError) throw error;
      throw new SourceControlProviderError("Bitbucket credential refresh failed.", "UNAVAILABLE");
    }
  }
  return new BitbucketClient({ accessToken: credentials.accessToken });
}
