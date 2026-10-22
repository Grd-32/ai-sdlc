import { prisma } from "@ai-sdlc/db";
import {
  decryptGitLabCredentials,
  encryptGitLabCredentials,
  GitLabClient,
  refreshGitLabOAuthToken,
  SourceControlProviderError,
} from "@ai-sdlc/source-control";

const REQUIRED_SCOPES = ["read_user", "read_api", "read_repository"];

export interface GitLabConnectionCredentials {
  id: string;
  organizationId: string;
  active: boolean;
  credentialCiphertext: string;
  scopes: string[];
}

function assertRequiredScopes(scopes: string[]): void {
  if (REQUIRED_SCOPES.some((scope) => !scopes.includes(scope))) {
    throw new SourceControlProviderError(
      "GitLab authorization is missing required read-only scopes.",
      "PERMISSION",
    );
  }
}

export async function createGitLabClient(
  connection: GitLabConnectionCredentials,
): Promise<GitLabClient> {
  if (!connection.active) {
    throw new SourceControlProviderError("GitLab connection is disconnected.", "AUTHENTICATION");
  }
  assertRequiredScopes(connection.scopes);
  let credentials = decryptGitLabCredentials(connection.credentialCiphertext);
  if (Date.parse(credentials.expiresAt) <= Date.now() + 5 * 60 * 1000) {
    const clientId = process.env["GITLAB_OAUTH_CLIENT_ID"];
    const clientSecret = process.env["GITLAB_OAUTH_CLIENT_SECRET"];
    if (!clientId || !clientSecret) {
      throw new SourceControlProviderError(
        "GitLab OAuth is not configured for token refresh.",
        "UNAVAILABLE",
      );
    }

    try {
      const refreshed = await refreshGitLabOAuthToken({
        clientId,
        clientSecret,
        refreshToken: credentials.refreshToken,
      });
      assertRequiredScopes(refreshed.scope);
      const encrypted = encryptGitLabCredentials({
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString(),
      });
      const updated = await prisma.sourceControlConnection.updateMany({
        where: {
          id: connection.id,
          organizationId: connection.organizationId,
          provider: "GITLAB",
          active: true,
          credentialCiphertext: connection.credentialCiphertext,
        },
        data: { credentialCiphertext: encrypted, scopes: refreshed.scope },
      });

      if (updated.count === 1) {
        credentials = {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          expiresAt: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString(),
        };
      } else {
        const latest = await prisma.sourceControlConnection.findFirst({
          where: {
            id: connection.id,
            organizationId: connection.organizationId,
            provider: "GITLAB",
            active: true,
          },
          select: { credentialCiphertext: true, scopes: true },
        });
        if (!latest) {
          throw new SourceControlProviderError(
            "GitLab connection was disconnected during token refresh.",
            "AUTHENTICATION",
          );
        }
        assertRequiredScopes(latest.scopes);
        credentials = decryptGitLabCredentials(latest.credentialCiphertext);
        if (Date.parse(credentials.expiresAt) <= Date.now()) {
          throw new SourceControlProviderError(
            "GitLab token refresh did not produce an active credential.",
            "AUTHENTICATION",
          );
        }
      }
    } catch (error) {
      if (error instanceof SourceControlProviderError) throw error;
      throw new SourceControlProviderError("GitLab credential refresh failed.", "UNAVAILABLE");
    }
  }

  return new GitLabClient({ accessToken: credentials.accessToken });
}
