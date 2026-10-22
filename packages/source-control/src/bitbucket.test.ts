import { beforeEach, describe, expect, it, vi } from "vitest";
import { BitbucketClient } from "./bitbucket.js";

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("Bitbucket provider adapter", () => {
  beforeEach(() => fetchMock.mockReset());

  it("verifies the authorized account and lists only its visible workspaces", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          uuid: "{user-1}",
          display_name: "Developer",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          values: [{ uuid: "{workspace-1}", slug: "acme", name: "Acme" }],
        }),
      );
    const client = new BitbucketClient({
      accessToken: "private-token",
      fetchImplementation: fetchMock,
    });

    await expect(client.getCurrentUser()).resolves.toEqual({
      uuid: "{user-1}",
      username: "Developer",
      displayName: "Developer",
    });
    const workspaces = await client.listWorkspaces();

    expect(workspaces.items).toEqual([{ uuid: "{workspace-1}", slug: "acme", name: "Acme" }]);
    expect(workspaces.complete).toBe(true);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://api.bitbucket.org/2.0/user",
      "https://api.bitbucket.org/2.0/workspaces?pagelen=100",
    ]);
  });

  it("lists workspace repositories and safely follows same-host pagination", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          values: [
            {
              uuid: "{repo-1}",
              name: "service",
              workspace: { slug: "acme" },
              mainbranch: { name: "main" },
              is_private: true,
              links: { html: { href: "https://bitbucket.org/acme/service" } },
            },
          ],
          next: "https://api.bitbucket.org/2.0/repositories/acme?page=2",
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ values: [] }));
    const client = new BitbucketClient({
      accessToken: "private-token",
      fetchImplementation: fetchMock,
    });

    const result = await client.listRepositories("acme");

    expect(result.items[0]).toMatchObject({
      provider: "BITBUCKET",
      externalId: "{repo-1}",
      owner: "acme",
      name: "service",
      defaultBranch: "main",
      private: true,
    });
    expect(result.complete).toBe(true);
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe(
      "Bearer private-token",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://api.bitbucket.org/2.0/repositories/acme?page=2",
    );
  });

  it("normalizes pull requests and collects complete diffstat and unified patch data", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          values: [
            {
              id: 17,
              title: "Fix authorization",
              state: "MERGED",
              created_on: "2026-10-01T10:00:00Z",
              updated_on: "2026-10-02T10:00:00Z",
              closed_on: "2026-10-02T10:00:00Z",
              author: { nickname: "dev", display_name: "Developer" },
              source: { branch: { name: "fix/auth" }, commit: { hash: "head-sha" } },
              destination: { branch: { name: "main" } },
              links: { html: { href: "https://bitbucket.org/acme/service/pull-requests/17" } },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          values: [
            {
              status: "modified",
              lines_added: 4,
              lines_removed: 1,
              old: { path: "src/auth.ts" },
              new: { path: "src/auth.ts" },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          [
            "diff --git a/src/auth.ts b/src/auth.ts",
            "index 1234567..abcdef0 100644",
            "--- a/src/auth.ts",
            "+++ b/src/auth.ts",
            "@@ -1,2 +1,3 @@",
            " const allowed = true;",
            "+checkAuthorization();",
            "-skipAuthorization();",
            " return allowed;",
            "",
          ].join("\n"),
          { status: 200, headers: { "content-type": "text/plain" } },
        ),
      );
    const client = new BitbucketClient({ accessToken: "token", fetchImplementation: fetchMock });
    const window = {
      start: new Date("2026-09-12T00:00:00Z"),
      end: new Date("2026-10-12T00:00:00Z"),
    };

    const requests = await client.listPullRequests("acme", "service", window);
    const files = await client.getPullRequestFiles("acme", "service", 17);

    expect(requests.items[0]).toMatchObject({
      number: 17,
      state: "MERGED",
      author: "Developer",
      sourceBranch: "fix/auth",
      targetBranch: "main",
      headSha: "head-sha",
      mergedAt: "2026-10-02T10:00:00Z",
    });

    const pullRequestRequest = fetchMock.mock.calls[0]?.[0];
    expect(typeof pullRequestRequest).toBe("string");
    if (typeof pullRequestRequest !== "string") {
      throw new Error("Expected a Bitbucket API URL string.");
    }
    expect(decodeURIComponent(pullRequestRequest)).toContain(
      'updated_on >= "2026-09-12T00:00:00.000Z"',
    );
    expect(files.items).toEqual([
      {
        path: "src/auth.ts",
        status: "MODIFIED",
        additions: 4,
        deletions: 1,
        patch: [
          "@@ -1,2 +1,3 @@",
          " const allowed = true;",
          "+checkAuthorization();",
          "-skipAuthorization();",
          " return allowed;",
        ].join("\n"),
      },
    ]);
    expect(files.capability.status).toBe("SUPPORTED");
    expect(files.complete).toBe(true);
  });

  it("collects paginated branch restrictions without interpreting configuration as enforcement", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          values: [{ id: 4, kind: "require_approvals_to_merge", pattern: "main", value: 2 }],
          next: "https://api.bitbucket.org/2.0/repositories/acme/service/branch-restrictions?page=2",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          values: [
            { id: 5, kind: "require_passing_builds_to_merge", pattern: "release/*", value: 1 },
          ],
        }),
      );
    const client = new BitbucketClient({
      accessToken: "private-token",
      fetchImplementation: fetchMock,
    });

    const restrictions = await client.listBranchRestrictions("acme", "service");

    expect(restrictions.items).toEqual([
      { id: 4, kind: "require_approvals_to_merge", pattern: "main", value: 2 },
      { id: 5, kind: "require_passing_builds_to_merge", pattern: "release/*", value: 1 },
    ]);
    expect(restrictions.complete).toBe(true);
    expect(restrictions.capability.status).toBe("SUPPORTED");
    expect(restrictions.capability.detail).toContain("does not verify effective branch protection");
  });

  it("rejects pagination links outside the Bitbucket API host", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        values: [],
        next: "https://attacker.example/steal-token",
      }),
    );
    const client = new BitbucketClient({ accessToken: "token", fetchImplementation: fetchMock });

    await expect(client.listRepositories("acme")).rejects.toMatchObject({
      kind: "INVALID_RESPONSE",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects partial or oversized patch results instead of treating them as complete", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          values: [
            {
              status: "modified",
              lines_added: 1,
              lines_removed: 0,
              old: { path: "src/auth.ts" },
              new: { path: "src/auth.ts" },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(new Response("diff --git a/other.ts b/other.ts\n", { status: 200 }));
    const client = new BitbucketClient({ accessToken: "token", fetchImplementation: fetchMock });

    await expect(client.getPullRequestFiles("acme", "service", 17)).rejects.toMatchObject({
      kind: "INVALID_RESPONSE",
    });

    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          values: [
            {
              status: "modified",
              lines_added: 1,
              lines_removed: 0,
              old: { path: "src/auth.ts" },
              new: { path: "src/auth.ts" },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: { "content-length": String(5 * 1024 * 1024 + 1) },
        }),
      );
    await expect(client.getPullRequestFiles("acme", "service", 17)).rejects.toThrow(
      "exceeds the supported 5 MiB analysis limit",
    );
  });

  it("maps authorization failures to actionable provider errors", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }));
    const client = new BitbucketClient({ accessToken: "token", fetchImplementation: fetchMock });

    await expect(client.listRepositories("acme")).rejects.toMatchObject({
      kind: "PERMISSION",
    });
  });

  it("collects validated pull-request commit metadata", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        values: [
          {
            hash: "abc123",
            message: "Add safe validation",
            date: "2026-10-01T12:00:00Z",
            author: { raw: "Developer" },
            links: { html: { href: "https://bitbucket.org/acme/service/commits/abc123" } },
          },
        ],
      }),
    );
    const result = await new BitbucketClient({
      accessToken: "private-token",
      fetchImplementation: fetchMock,
    }).listPullRequestCommits("acme", "service", 17);

    expect(result).toMatchObject({
      complete: true,
      capability: { status: "SUPPORTED" },
      items: [
        {
          provider: "BITBUCKET",
          sha: "abc123",
          message: "Add safe validation",
          authorName: "Developer",
          committedAt: "2026-10-01T12:00:00Z",
          webUrl: "https://bitbucket.org/acme/service/commits/abc123",
        },
      ],
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.bitbucket.org/2.0/repositories/acme/service/pullrequests/17/commits?pagelen=100",
    );
  });

  it("rejects malformed pull-request commit metadata", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ values: [{ hash: "abc123" }] }));
    const client = new BitbucketClient({
      accessToken: "private-token",
      fetchImplementation: fetchMock,
    });

    await expect(client.listPullRequestCommits("acme", "service", 17)).rejects.toMatchObject({
      kind: "INVALID_RESPONSE",
    });
  });

  it("surfaces pull-request commit permission and network failures", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }));
    const client = new BitbucketClient({
      accessToken: "private-token",
      fetchImplementation: fetchMock,
    });
    await expect(client.listPullRequestCommits("acme", "service", 17)).rejects.toMatchObject({
      kind: "PERMISSION",
    });

    fetchMock.mockReset();
    fetchMock.mockRejectedValueOnce(new Error("connection reset"));
    await expect(client.listPullRequestCommits("acme", "service", 17)).rejects.toMatchObject({
      kind: "UNAVAILABLE",
    });
  });
});
