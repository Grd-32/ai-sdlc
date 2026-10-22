import { describe, expect, it, vi } from "vitest";
import {
  exchangeAzureDevOpsOAuthCode,
  getAzureDevOpsAuthorizationUrl,
  refreshAzureDevOpsOAuthToken,
} from "./azure-devops-oauth.js";

const tokenBody = {
  access_token: "entra-access",
  refresh_token: "entra-refresh",
  expires_in: 3600,
  scope: "499b84ac-1321-427f-aa17-267ca6975798/.default offline_access",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Azure DevOps Microsoft Entra OAuth", () => {
  it("builds a tenant-specific PKCE authorization URL with Azure DevOps resource scope", () => {
    const url = getAzureDevOpsAuthorizationUrl({
      clientId: "client-id",
      tenantId: "organizations",
      redirectUri: "https://nomalog.example/api/auth/azure-devops/callback",
      state: "state",
      codeChallenge: "challenge",
    });

    expect(url.origin).toBe("https://login.microsoftonline.com");
    expect(url.pathname).toBe("/organizations/oauth2/v2.0/authorize");
    expect(url.searchParams.get("scope")).toBe(
      "499b84ac-1321-427f-aa17-267ca6975798/.default offline_access",
    );
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  it("exchanges and refreshes delegated tokens using the tenant's token endpoint", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(jsonResponse(tokenBody)));
    const options = {
      clientId: "client-id",
      clientSecret: "client-secret",
      tenantId: "organizations",
      fetchImplementation: fetchMock,
    };

    await expect(
      exchangeAzureDevOpsOAuthCode({
        ...options,
        code: "auth-code",
        codeVerifier: "verifier",
        redirectUri: "https://nomalog.example/api/auth/azure-devops/callback",
      }),
    ).resolves.toMatchObject({
      accessToken: "entra-access",
      refreshToken: "entra-refresh",
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://login.microsoftonline.com/organizations/oauth2/v2.0/token",
    );
    const exchangeBody = fetchMock.mock.calls[0]?.[1]?.body;
    expect(exchangeBody).toBeInstanceOf(URLSearchParams);
    if (!(exchangeBody instanceof URLSearchParams)) throw new Error("Expected OAuth form body.");
    expect(exchangeBody.toString()).toContain("code_verifier=verifier");

    await refreshAzureDevOpsOAuthToken({ ...options, refreshToken: "entra-refresh" });
    const refreshBody = fetchMock.mock.calls[1]?.[1]?.body;
    expect(refreshBody).toBeInstanceOf(URLSearchParams);
    if (!(refreshBody instanceof URLSearchParams)) throw new Error("Expected OAuth form body.");
    expect(refreshBody.toString()).toContain("grant_type=refresh_token");
  });

  it("rejects malformed tenant identifiers and invalid token responses", async () => {
    expect(() =>
      getAzureDevOpsAuthorizationUrl({
        clientId: "client-id",
        tenantId: "https://attacker.example",
        redirectUri: "https://nomalog.example/callback",
        state: "state",
        codeChallenge: "challenge",
      }),
    ).toThrow("Azure tenant must be");

    const invalidFetch = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}));
    await expect(
      refreshAzureDevOpsOAuthToken({
        clientId: "client-id",
        clientSecret: "client-secret",
        tenantId: "organizations",
        refreshToken: "refresh",
        fetchImplementation: invalidFetch,
      }),
    ).rejects.toMatchObject({ kind: "INVALID_RESPONSE" });
  });
});
