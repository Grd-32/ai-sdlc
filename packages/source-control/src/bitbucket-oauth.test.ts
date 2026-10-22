import { describe, expect, it, vi } from "vitest";
import {
  exchangeBitbucketOAuthCode,
  getBitbucketAuthorizationUrl,
  refreshBitbucketOAuthToken,
  revokeBitbucketOAuthToken,
} from "./bitbucket-oauth.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const tokenBody = {
  access_token: "access-secret",
  refresh_token: "refresh-secret",
  expires_in: 3600,
  scopes: "repository pullrequest pipeline",
};

describe("Bitbucket OAuth", () => {
  it("builds an authorization URL with bound state and redirect URI", () => {
    const url = getBitbucketAuthorizationUrl({
      clientId: "client-id",
      redirectUri: "https://nomalog.example/api/auth/bitbucket/callback",
      state: "opaque-state",
    });
    expect(url.origin).toBe("https://bitbucket.org");
    expect(url.searchParams.get("state")).toBe("opaque-state");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://nomalog.example/api/auth/bitbucket/callback",
    );
  });

  it("exchanges and refreshes tokens with client authentication kept server-side", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(jsonResponse(tokenBody)));
    const options = {
      clientId: "client-id",
      clientSecret: "client-secret",
      fetchImplementation: fetchMock,
    };

    await expect(
      exchangeBitbucketOAuthCode({
        ...options,
        code: "code",
        redirectUri: "https://nomalog.example/api/auth/bitbucket/callback",
      }),
    ).resolves.toMatchObject({
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
      scopes: ["repository", "pullrequest", "pipeline"],
    });
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe(
      `Basic ${Buffer.from("client-id:client-secret").toString("base64")}`,
    );
    const exchangeBody = fetchMock.mock.calls[0]?.[1]?.body;
    expect(exchangeBody).toBeInstanceOf(URLSearchParams);
    if (!(exchangeBody instanceof URLSearchParams)) throw new Error("Expected OAuth form body.");
    expect(exchangeBody.toString()).toContain("grant_type=authorization_code");

    await refreshBitbucketOAuthToken({ ...options, refreshToken: "refresh-secret" });
    const refreshBody = fetchMock.mock.calls[1]?.[1]?.body;
    expect(refreshBody).toBeInstanceOf(URLSearchParams);
    if (!(refreshBody instanceof URLSearchParams)) throw new Error("Expected OAuth form body.");
    expect(refreshBody.toString()).toContain("grant_type=refresh_token");
  });

  it("surfaces OAuth failures and token revocation errors", async () => {
    const rejectedFetch = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, 401));
    await expect(
      exchangeBitbucketOAuthCode({
        clientId: "client",
        clientSecret: "secret",
        code: "code",
        redirectUri: "https://nomalog.example/callback",
        fetchImplementation: rejectedFetch,
      }),
    ).rejects.toMatchObject({ kind: "AUTHENTICATION" });

    const revokeFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 500 }));
    await expect(
      revokeBitbucketOAuthToken({
        clientId: "client",
        clientSecret: "secret",
        token: "access",
        fetchImplementation: revokeFetch,
      }),
    ).rejects.toMatchObject({ kind: "UNAVAILABLE" });
  });
});
