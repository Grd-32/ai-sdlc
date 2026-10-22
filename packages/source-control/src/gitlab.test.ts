import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitLabClient } from "./gitlab.js";
import { SourceControlProviderError, type CapabilityStatus } from "./index.js";

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("GitLab provider adapter", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("uses the fixed GitLab.com API and paginates project discovery", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          [
            {
              id: 42,
              name: "service",
              path_with_namespace: "group/platform/service",
              default_branch: "main",
              visibility: "private",
              web_url: "https://gitlab.com/group/platform/service",
            },
          ],
          { "x-next-page": "2" },
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: 43,
            name: "docs",
            path_with_namespace: "group/docs",
            default_branch: "main",
            visibility: "public",
            web_url: "https://gitlab.com/group/docs",
          },
        ]),
      );
    const client = new GitLabClient({
      accessToken: "private-test-token",
      fetchImplementation: fetchMock,
    });

    const result = await client.listRepositories();

    expect(result.items.map((item) => [item.externalId, item.owner, item.name])).toEqual([
      ["42", "group/platform", "service"],
      ["43", "group", "docs"],
    ]);
    expect(result.items[0]?.private).toBe(true);
    expect(result.complete).toBe(true);
    const firstRequest = fetchMock.mock.calls[0];
    expect(firstRequest?.[0]).toBe(
      "https://gitlab.com/api/v4/projects?membership=true&order_by=last_activity_at&sort=desc&per_page=100",
    );
    expect(new Headers(firstRequest?.[1]?.headers).get("PRIVATE-TOKEN")).toBe("private-test-token");
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://gitlab.com/api/v4/projects?membership=true&order_by=last_activity_at&sort=desc&page=2&per_page=100",
      expect.anything(),
    );
  });

  it("normalizes merge requests and keeps a provider evidence reference", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 9001,
          iid: 17,
          title: "Fix auth flow",
          state: "merged",
          author: { username: "dev" },
          source_branch: "fix/auth",
          target_branch: "main",
          diff_refs: { head_sha: "head-sha" },
          changes_count: "2",
          created_at: "2026-10-01T10:00:00Z",
          updated_at: "2026-10-02T10:00:00Z",
          merged_at: "2026-10-02T11:00:00Z",
          web_url: "https://gitlab.com/group/service/-/merge_requests/17",
        },
      ]),
    );
    const client = new GitLabClient({ accessToken: "token", fetchImplementation: fetchMock });

    const result = await client.listMergeRequests("42", {
      start: new Date("2026-10-01T00:00:00Z"),
      end: new Date("2026-10-31T23:59:59Z"),
    });

    expect(result.items[0]).toMatchObject({
      provider: "GITLAB",
      externalId: "9001",
      number: 17,
      state: "MERGED",
      headSha: "head-sha",
      additions: null,
      original: {
        externalId: "42!17",
        url: "https://gitlab.com/group/service/-/merge_requests/17",
      },
    });
  });

  it("reports omitted file diffs as partial instead of treating them as a clean change", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        changes: [
          { old_path: "a.ts", new_path: "a.ts", diff: "@@ -1 +1 @@\n-old\n+new" },
          { old_path: "b.ts", new_path: "b.ts", diff: "", too_large: true },
          { old_path: "c.ts", new_path: "c.ts", diff: "@@ -1 +1 @@\n-old\n+new", collapsed: true },
        ],
      }),
    );
    const client = new GitLabClient({ accessToken: "token", fetchImplementation: fetchMock });

    const result = await client.getMergeRequestFiles("42", 3);

    expect(result.items[0]).toMatchObject({
      path: "a.ts",
      status: "MODIFIED",
      additions: 1,
      deletions: 1,
    });
    expect(result.items[1]?.patch).toBeNull();
    expect(result.items[1]?.additions).toBeNull();
    expect(result.items[2]?.patch).toBe("@@ -1 +1 @@\n-old\n+new");
    expect(result.items[2]?.additions).toBeNull();
    expect(result.complete).toBe(false);
    expect(result.capability.status).toBe("PARTIALLY_SUPPORTED");
  });

  it("normalizes merge-request approvals and pipeline evidence", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          approved: true,
          approved_by: [
            {
              user: { username: "reviewer" },
              approved_at: "2026-10-02T11:00:00Z",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: 77,
            status: "success",
            ref: "main",
            sha: "head-sha",
            web_url: "https://gitlab.com/group/service/-/pipelines/77",
          },
        ]),
      );
    const client = new GitLabClient({ accessToken: "token", fetchImplementation: fetchMock });

    const approvals = await client.listMergeRequestApprovals("42", 17);
    const pipelines = await client.listMergeRequestPipelines("42", 17);

    expect(approvals.items[0]).toMatchObject({
      provider: "GITLAB",
      actor: "reviewer",
      state: "APPROVED",
      submittedAt: "2026-10-02T11:00:00Z",
    });
    expect(approvals.complete).toBe(true);
    expect(pipelines.items[0]).toMatchObject({
      provider: "GITLAB",
      externalId: "77",
      status: "success",
      sha: "head-sha",
    });
  });

  it("collects vulnerability findings only through a pipeline-scoped query", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        {
          uuid: "finding-1",
          report_type: "sast",
          severity: "high",
          name: "Command injection",
          state: "detected",
          scanner: { external_id: "rule-1", name: "GitLab SAST" },
          location: { file: "src/handler.ts", start_line: 12 },
          evidence: { request: "must-not-be-persisted" },
        },
      ]),
    );
    const client = new GitLabClient({ accessToken: "token", fetchImplementation: fetchMock });

    const result = await client.listPipelineVulnerabilityFindings(
      "group/project",
      "77",
      "head-sha",
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://gitlab.com/api/v4/projects/group%2Fproject/vulnerability_findings?scope=all&pipeline_id=77&per_page=100",
    );
    expect(result).toMatchObject({
      complete: true,
      items: [
        {
          id: "finding-1",
          reportType: "sast",
          severity: "high",
          file: "src/handler.ts",
          line: 12,
          pipelineId: "77",
          headSha: "head-sha",
        },
      ],
    });
    expect(result.items[0]).not.toHaveProperty("evidence");
  });

  it("reads secret-detection artifacts and excludes raw report fields", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        vulnerabilities: [
          {
            id: "secret-id",
            category: "GitLab Personal Access Token",
            message: "Generic token detected",
            severity: "critical",
            location: { file: "config/local.env", start_line: 5 },
            raw_source_code_extract: "glpat-this-value-must-not-leak",
          },
        ],
      }),
    );
    const client = new GitLabClient({ accessToken: "token", fetchImplementation: fetchMock });

    const result = await client.getSecretDetectionReport("42", "900", "77", "head-sha");

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://gitlab.com/api/v4/projects/42/jobs/900/artifacts?file_type=secret_detection",
    );
    expect(result.items[0]).toMatchObject({
      reportType: "secret_detection",
      severity: "critical",
      file: "config/local.env",
      line: 5,
      pipelineId: "77",
      headSha: "head-sha",
    });
    expect(result.items[0]?.id).not.toBe("secret-id");
    expect(JSON.stringify(result)).not.toContain("glpat-this-value-must-not-leak");
  });

  it("downloads secret artifacts from trusted redirects without forwarding the GitLab token", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://storage.googleapis.com/artifacts/report.json?sig=signed" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          vulnerabilities: [
            {
              id: "secret-id",
              category: "Secret detected",
              severity: "high",
              location: { file: "config.env", start_line: 2 },
            },
          ],
        }),
      );
    const client = new GitLabClient({
      accessToken: "private-token",
      fetchImplementation: fetchMock,
    });

    await client.getSecretDetectionReport("42", "900", "77", "head-sha");

    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("PRIVATE-TOKEN")).toBe(
      "private-token",
    );
    const redirectedRequest = fetchMock.mock.calls[1]?.[0];
    expect(redirectedRequest).toBeInstanceOf(URL);
    if (!(redirectedRequest instanceof URL)) throw new Error("Expected URL artifact redirect.");
    expect(redirectedRequest.href).toBe(
      "https://storage.googleapis.com/artifacts/report.json?sig=signed",
    );
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).has("PRIVATE-TOKEN")).toBe(false);
  });

  it("rejects untrusted secret-artifact redirects", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/internal" },
      }),
    );
    const client = new GitLabClient({
      accessToken: "private-token",
      fetchImplementation: fetchMock,
    });

    await expect(
      client.getSecretDetectionReport("42", "900", "77", "head-sha"),
    ).rejects.toMatchObject({
      kind: "INVALID_RESPONSE",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("collects protected branch settings without treating wildcard rules as exact branch matches", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 101,
          name: "main",
          allow_force_push: false,
          code_owner_approval_required: true,
          push_access_levels: [{ access_level: 40 }],
          merge_access_levels: [{ access_level: 30 }],
        },
      ]),
    );
    const client = new GitLabClient({ accessToken: "token", fetchImplementation: fetchMock });

    const result = await client.listProtectedBranches("group/project");

    expect(result).toMatchObject({
      complete: true,
      items: [
        {
          name: "main",
          allowForcePush: false,
          codeOwnerApprovalRequired: true,
          pushAccessLevels: [40],
          mergeAccessLevels: [30],
        },
      ],
    });
  });

  it.each([
    [401, "AUTHENTICATION"],
    [403, "PERMISSION"],
    [429, "RATE_LIMITED"],
    [503, "UNAVAILABLE"],
  ] as const)("distinguishes GitLab HTTP %i as %s", async (status, expectedKind) => {
    fetchMock.mockResolvedValueOnce(
      new Response("sensitive upstream body must not be propagated", {
        status,
        headers: { "retry-after": "12" },
      }),
    );
    const client = new GitLabClient({
      accessToken: "secret-token",
      fetchImplementation: fetchMock,
    });

    const error = await client.getCurrentUser().catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(SourceControlProviderError);
    expect((error as SourceControlProviderError).kind).toBe(expectedKind);
    expect((error as Error).message).not.toContain("secret-token");
    expect((error as Error).message).not.toContain("sensitive upstream body");
  });

  it("reports GitLab webhook, security, and branch policy capabilities truthfully", () => {
    const client = new GitLabClient({ accessToken: "token", fetchImplementation: fetchMock });

    const report = client.getCapabilities();

    expect(report.provider).toBe("GITLAB");
    expect(report.capabilities.webhooks?.status).toBe("PARTIALLY_SUPPORTED");
    expect(report.capabilities.review_evidence?.status).toBe("PARTIALLY_SUPPORTED");
    expect(report.capabilities.security_findings?.status).toBe("PARTIALLY_SUPPORTED");
    expect(report.capabilities.branch_policy?.status).toBe("SUPPORTED");
    const validStatuses: CapabilityStatus[] = [
      "SUPPORTED",
      "PARTIALLY_SUPPORTED",
      "UNSUPPORTED",
      "UNAVAILABLE_DUE_TO_PERMISSIONS",
      "UNAVAILABLE_DUE_TO_PROVIDER_CONFIGURATION",
      "NOT_YET_IMPLEMENTED",
    ];
    expect(
      Object.values(report.capabilities).every((capability) =>
        validStatuses.includes(capability.status),
      ),
    ).toBe(true);
  });
});
