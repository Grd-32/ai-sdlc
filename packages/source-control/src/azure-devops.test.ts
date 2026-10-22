import { beforeEach, describe, expect, it, vi } from "vitest";
import { AzureDevOpsClient } from "./azure-devops.js";

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

function textResponse(body: string, contentType = "text/plain"): Response {
  return new Response(body, { status: 200, headers: { "content-type": contentType } });
}

function client(): AzureDevOpsClient {
  return new AzureDevOpsClient({
    accessToken: "server-only-token",
    organization: "acme",
    fetchImplementation: fetchMock,
  });
}

describe("Azure DevOps provider adapter", () => {
  beforeEach(() => fetchMock.mockReset());

  it("lists projects visible within the configured organization", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        count: 1,
        value: [{ id: "project-id", name: "platform" }],
      }),
    );

    const result = await client().listProjects();

    expect(result.items).toEqual([{ id: "project-id", name: "platform" }]);
    expect(result.complete).toBe(true);
    const request = fetchMock.mock.calls[0]?.[0];
    expect(request).toBeInstanceOf(URL);
    if (!(request instanceof URL)) throw new Error("Expected Azure DevOps project URL.");
    expect(request.origin).toBe("https://dev.azure.com");
    expect(request.pathname).toBe("/acme/_apis/projects");
    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
        .get("Authorization")
        ?.startsWith("Bearer "),
    ).toBe(true);
  });

  it("lists project repositories and follows continuation tokens within the organization", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          {
            count: 1,
            value: [
              {
                id: "repo-id",
                name: "service",
                defaultBranch: "refs/heads/main",
                project: { name: "platform" },
              },
            ],
          },
          { "x-ms-continuationtoken": "page-2" },
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ count: 0, value: [] }));

    const result = await client().listRepositories("platform");

    expect(result.items[0]).toMatchObject({
      provider: "AZURE_DEVOPS",
      externalId: "repo-id",
      owner: "acme/platform",
      name: "service",
      defaultBranch: "main",
      private: true,
    });
    expect(result.complete).toBe(true);
    const firstRequest = fetchMock.mock.calls[0]?.[0];
    expect(firstRequest).toBeInstanceOf(URL);
    if (!(firstRequest instanceof URL)) throw new Error("Expected Azure DevOps URL.");
    expect(firstRequest.origin).toBe("https://dev.azure.com");
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe(
      "Bearer server-only-token",
    );
    const nextRequest = fetchMock.mock.calls[1]?.[0];
    expect(nextRequest).toBeInstanceOf(URL);
    if (!(nextRequest instanceof URL)) throw new Error("Expected continuation URL.");
    expect(nextRequest.searchParams.get("continuationToken")).toBe("page-2");
  });

  it("uses the requested assessment window and normalizes pull-request metadata", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        count: 1,
        value: [
          {
            pullRequestId: 23,
            title: "Fix access control",
            status: "completed",
            creationDate: "2026-10-01T10:00:00Z",
            closedDate: "2026-10-02T10:00:00Z",
            sourceRefName: "refs/heads/fix/access",
            targetRefName: "refs/heads/main",
            lastMergeSourceCommit: { commitId: "head-sha" },
            createdBy: { displayName: "Developer" },
            repository: {
              id: "repo-id",
              name: "service",
              project: { name: "platform" },
            },
          },
        ],
      }),
    );
    const window = {
      start: new Date("2026-09-12T00:00:00Z"),
      end: new Date("2026-10-12T00:00:00Z"),
    };

    const result = await client().listPullRequests("platform", "repo-id", window);

    expect(result.items[0]).toMatchObject({
      externalId: "platform/service/23",
      number: 23,
      state: "MERGED",
      author: "Developer",
      sourceBranch: "fix/access",
      targetBranch: "main",
      headSha: "head-sha",
      mergedAt: "2026-10-02T10:00:00Z",
    });

    const request = fetchMock.mock.calls[0]?.[0];
    expect(request).toBeInstanceOf(URL);
    if (!(request instanceof URL)) throw new Error("Expected Azure DevOps pull-request URL.");
    expect(request.searchParams.get("searchCriteria.minTime")).toBe("2026-09-12T00:00:00.000Z");
    expect(request.searchParams.get("searchCriteria.maxTime")).toBe("2026-10-12T00:00:00.000Z");
  });

  it("collects the latest iteration and builds bounded unified diffs for changed files", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          value: [
            {
              id: 4,
              sourceRefCommit: { commitId: "head-commit" },
              targetRefCommit: { commitId: "base-commit" },
              commonRefCommit: { commitId: "merge-base-commit" },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          changeEntries: [{ changeType: "edit", item: { path: "/src/auth.ts" } }],
          nextSkip: 1,
        }),
      )
      .mockResolvedValueOnce(textResponse("const safe = true;\n"))
      .mockResolvedValueOnce(textResponse("const safe = false;\n"))
      .mockResolvedValueOnce(
        jsonResponse({
          changeEntries: [{ changeType: "add", item: { path: "/src/new.ts" } }],
        }),
      )
      .mockResolvedValueOnce(textResponse("export const added = true;\n"));

    const result = await client().getPullRequestFiles("platform", "repo-id", 23);

    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      path: "/src/auth.ts",
      status: "MODIFIED",
      additions: 1,
      deletions: 1,
    });
    expect(result.items[0]?.patch).toContain("-const safe = true;");
    expect(result.items[0]?.patch).toContain("+const safe = false;");
    expect(result.items[1]).toMatchObject({
      path: "/src/new.ts",
      status: "ADDED",
      additions: 1,
      deletions: 0,
    });
    expect(result.items[1]?.patch).toContain("+export const added = true;");
    expect(result.complete).toBe(true);
    expect(result.capability.status).toBe("SUPPORTED");
    const changeRequest = fetchMock.mock.calls[1]?.[0];
    expect(changeRequest).toBeInstanceOf(URL);
    if (!(changeRequest instanceof URL)) throw new Error("Expected iteration changes URL.");
    expect(changeRequest.pathname).toContain("/iterations/4/changes");
    const oldContentRequest = fetchMock.mock.calls[2]?.[0];
    expect(oldContentRequest).toBeInstanceOf(URL);
    if (!(oldContentRequest instanceof URL)) throw new Error("Expected item content URL.");
    expect(oldContentRequest.searchParams.get("versionDescriptor.version")).toBe(
      "merge-base-commit",
    );
    const nextPageRequest = fetchMock.mock.calls[4]?.[0];
    expect(nextPageRequest).toBeInstanceOf(URL);
    if (!(nextPageRequest instanceof URL)) throw new Error("Expected next changes page URL.");
    expect(nextPageRequest.searchParams.get("$skip")).toBe("1");
  });

  it("marks binary current-iteration content incomplete instead of treating it as an empty diff", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          value: [
            {
              id: 2,
              sourceRefCommit: { commitId: "head-commit" },
              targetRefCommit: { commitId: "base-commit" },
              commonRefCommit: { commitId: "merge-base-commit" },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          changeEntries: [{ changeType: "add", item: { path: "/assets/logo.png" } }],
        }),
      )
      .mockResolvedValueOnce(textResponse("binary-content", "application/octet-stream"));

    const result = await client().getPullRequestFiles("platform", "repo-id", 23);

    expect(result.items[0]).toMatchObject({
      path: "/assets/logo.png",
      status: "ADDED",
      additions: null,
      deletions: null,
      patch: null,
    });
    expect(result.complete).toBe(false);
    expect(result.capability.status).toBe("PARTIALLY_SUPPORTED");
  });

  it("rejects JSON item metadata rather than analyzing it as source text", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          value: [
            {
              id: 2,
              sourceRefCommit: { commitId: "head-commit" },
              targetRefCommit: { commitId: "base-commit" },
              commonRefCommit: { commitId: "merge-base-commit" },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          changeEntries: [{ changeType: "add", item: { path: "/src/new.ts" } }],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ path: "/src/new.ts", content: "export {};" }));

    await expect(client().getPullRequestFiles("platform", "repo-id", 23)).rejects.toMatchObject({
      kind: "INVALID_RESPONSE",
    });
  });

  it("collects paginated Advanced Security alerts without retaining secret values", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          {
            value: [
              {
                alertId: 42,
                alertType: "secret",
                severity: "high",
                state: "active",
                title: "Credential exposed",
                truncatedSecret: "do-not-retain",
                firstSeenDate: "2026-10-01T00:00:00Z",
              },
            ],
          },
          { "x-ms-continuationtoken": "next-page" },
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          value: [
            {
              alertId: 43,
              alertType: "code",
              severity: "critical",
              state: "active",
              title: "Unsafe deserialization",
            },
          ],
        }),
      );

    const result = await client().listSecurityAlerts("platform", "repo-id");

    expect(result.items).toEqual([
      {
        id: "42",
        type: "secret",
        severity: "high",
        title: "Secret detected",
        status: "active",
        firstSeenAt: "2026-10-01T00:00:00Z",
      },
      {
        id: "43",
        type: "code",
        severity: "critical",
        title: "Unsafe deserialization",
        status: "active",
        firstSeenAt: null,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("do-not-retain");
    expect(result.complete).toBe(true);
    const firstRequest = fetchMock.mock.calls[0]?.[0];
    expect(firstRequest).toBeInstanceOf(URL);
    if (!(firstRequest instanceof URL)) throw new Error("Expected Advanced Security URL.");
    expect(firstRequest.origin).toBe("https://advsec.dev.azure.com");
    expect(firstRequest.pathname).toBe("/acme/platform/_apis/alert/repositories/repo-id/alerts");
    const secondRequest = fetchMock.mock.calls[1]?.[0];
    expect(secondRequest).toBeInstanceOf(URL);
    if (!(secondRequest instanceof URL)) throw new Error("Expected paginated alert URL.");
    expect(secondRequest.searchParams.get("continuationToken")).toBe("next-page");
  });

  it("maps Advanced Security forbidden responses as permission limitations", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"message":"forbidden"}', {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(client().listSecurityAlerts("platform", "repo-id")).rejects.toMatchObject({
      kind: "PERMISSION",
    });
  });

  it("rejects unsupported change types instead of reporting an incomplete diff as clean", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          value: [
            {
              id: 2,
              sourceRefCommit: { commitId: "head-commit" },
              commonRefCommit: { commitId: "merge-base-commit" },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          changeEntries: [{ changeType: "encoding", item: { path: "/src/file.ts" } }],
        }),
      );

    await expect(client().getPullRequestFiles("platform", "repo-id", 23)).rejects.toMatchObject({
      kind: "INVALID_RESPONSE",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects aggregate diff content above the 5 MiB safety threshold", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          value: [
            {
              id: 2,
              sourceRefCommit: { commitId: "head-commit" },
              targetRefCommit: { commitId: "base-commit" },
              commonRefCommit: { commitId: "merge-base-commit" },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          changeEntries: [{ changeType: "add", item: { path: "/src/large.txt" } }],
        }),
      )
      .mockResolvedValueOnce(textResponse("x".repeat(5 * 1024 * 1024 + 1)));

    await expect(client().getPullRequestFiles("platform", "repo-id", 23)).rejects.toMatchObject({
      kind: "UNAVAILABLE",
    });
  });

  it("rejects text diffs above the bounded comparison complexity", async () => {
    const before = Array.from({ length: 501 }, (_, index) => `old-${index}`).join("\n");
    const after = Array.from({ length: 501 }, (_, index) => `new-${index}`).join("\n");
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          value: [
            {
              id: 2,
              sourceRefCommit: { commitId: "head-commit" },
              targetRefCommit: { commitId: "base-commit" },
              commonRefCommit: { commitId: "merge-base-commit" },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          changeEntries: [{ changeType: "edit", item: { path: "/src/complex.txt" } }],
        }),
      )
      .mockResolvedValueOnce(textResponse(before))
      .mockResolvedValueOnce(textResponse(after));

    await expect(client().getPullRequestFiles("platform", "repo-id", 23)).rejects.toMatchObject({
      kind: "UNAVAILABLE",
    });
  });

  it("collects scoped branch policies and maps forbidden access explicitly", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        count: 1,
        value: [
          {
            id: 4,
            isEnabled: true,
            isBlocking: true,
            type: { displayName: "Minimum reviewers" },
            settings: {
              scope: [{ refName: "refs/heads/main" }],
            },
          },
        ],
      }),
    );
    const policies = await client().listBranchPolicies("platform");
    expect(policies.items).toEqual([
      {
        id: 4,
        name: "Minimum reviewers",
        enabled: true,
        blocking: true,
        branchRef: "refs/heads/main",
      },
    ]);

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }));
    await expect(client().listRepositories("platform")).rejects.toMatchObject({
      kind: "PERMISSION",
    });
  });

  it("collects paginated Azure DevOps pull-request commit metadata", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          {
            count: 1,
            value: [
              {
                commitId: "abc123",
                comment: "Add safe validation",
                author: { name: "Developer", date: "2026-10-01T12:00:00Z" },
                remoteUrl: "https://dev.azure.com/acme/platform/_git/service/commit/abc123",
              },
            ],
          },
          { "x-ms-continuationtoken": "next-commits" },
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ count: 0, value: [] }));

    const result = await client().listPullRequestCommits("platform", "repo-id", 23);

    expect(result).toMatchObject({
      complete: true,
      capability: { status: "SUPPORTED" },
      items: [
        {
          provider: "AZURE_DEVOPS",
          sha: "abc123",
          message: "Add safe validation",
          authorName: "Developer",
          committedAt: "2026-10-01T12:00:00Z",
          webUrl: "https://dev.azure.com/acme/platform/_git/service/commit/abc123",
        },
      ],
    });
    const firstRequest = fetchMock.mock.calls[0]?.[0];
    const secondRequest = fetchMock.mock.calls[1]?.[0];
    expect(firstRequest).toBeInstanceOf(URL);
    expect(secondRequest).toBeInstanceOf(URL);
    if (!(firstRequest instanceof URL) || !(secondRequest instanceof URL)) {
      throw new Error("Expected Azure DevOps commit URLs.");
    }
    expect(firstRequest.pathname).toBe(
      "/acme/platform/_apis/git/repositories/repo-id/pullRequests/23/commits",
    );
    expect(firstRequest.searchParams.get("api-version")).toBe("7.1");
    expect(secondRequest.searchParams.get("continuationToken")).toBe("next-commits");
  });

  it("surfaces pull-request commit permission and network failures", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }));
    await expect(client().listPullRequestCommits("platform", "repo-id", 23)).rejects.toMatchObject({
      kind: "PERMISSION",
    });

    fetchMock.mockReset();
    fetchMock.mockRejectedValueOnce(new Error("connection reset"));
    await expect(client().listPullRequestCommits("platform", "repo-id", 23)).rejects.toMatchObject({
      kind: "UNAVAILABLE",
    });
  });

  it("rejects malformed Azure DevOps pull-request commit metadata", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ value: [{ commitId: "abc123" }] }));

    await expect(client().listPullRequestCommits("platform", "repo-id", 23)).rejects.toMatchObject({
      kind: "INVALID_RESPONSE",
    });
  });
});
