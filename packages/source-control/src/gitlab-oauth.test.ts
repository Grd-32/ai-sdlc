import { describe, expect, it, vi } from "vitest";
import {
  exchangeGitLabOAuthCode,
  refreshGitLabOAuthToken,
  revokeGitLabOAuthToken,
} from "./gitlab-oauth.js";

function tokenResponse(): Response {
  return new Response(
    JSON.stringify({
      access_token: "access-secret",
      refresh_token: "refresh-secret",
      expires_in: 7200,
      scope: "read_user read_api read_repository",
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("GitLab OAuth client", () => {
  it("exchanges authorization codes using PKCE without putting secrets in URLs", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(tokenResponse());

    const token = await exchangeGitLabOAuthCode({
      clientId: "client-id",
      clientSecret: "client-secret",
      code: "one-time-code",
      codeVerifier: "pkce-verifier",
      redirectUri: "https://nomalog.example/api/auth/gitlab/callback",
      fetchImplementation: fetchMock,
    });

    expect(token.scope).toEqual(["read_user", "read_api", "read_repository"]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://gitlab.com/oauth/token");
    const body = fetchMock.mock.calls[0]?.[1]?.body;
    expect(body).toBeInstanceOf(URLSearchParams);
    if (!(body instanceof URLSearchParams))
      throw new Error("OAuth request body must be URL-encoded.");
    const requestBody = body;
    expect(requestBody.get("client_secret")).toBe("client-secret");
    expect(requestBody.get("code_verifier")).toBe("pkce-verifier");
  });

  it("refreshes rotating OAuth credentials and revokes a token through POST bodies", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await refreshGitLabOAuthToken({
      clientId: "client-id",
      clientSecret: "client-secret",
      refreshToken: "previous-refresh-secret",
      fetchImplementation: fetchMock,
    });
    await revokeGitLabOAuthToken({
      clientId: "client-id",
      clientSecret: "client-secret",
      token: "access-secret",
      fetchImplementation: fetchMock,
    });

    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://gitlab.com/oauth/revoke");
    const revokeRequestBody = fetchMock.mock.calls[1]?.[1]?.body;
    expect(revokeRequestBody).toBeInstanceOf(URLSearchParams);
    if (!(revokeRequestBody instanceof URLSearchParams)) {
      throw new Error("Revocation request body must be URL-encoded.");
    }
    const revokeBody = revokeRequestBody;
    expect(revokeBody.get("token")).toBe("access-secret");
    expect(revokeBody.get("client_secret")).toBe("client-secret");
  });
});
