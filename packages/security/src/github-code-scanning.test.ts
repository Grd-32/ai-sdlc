import { describe, expect, it, vi } from "vitest";
import { createGitHubCodeScanningProvider } from "./index.js";

const providerOptions = (request: (path: string) => Promise<unknown>) => ({
  owner: "acme",
  repository: "payments",
  pullRequestNumber: 42,
  headSha: "head-sha",
  request,
});

describe("GitHub Code Scanning provider", () => {
  it("reports PASS only after a successful CodeQL check for the exact head has no alerts", async () => {
    const request = vi.fn((path: string) => {
      if (path.includes("/check-runs")) {
        return Promise.resolve({
          check_runs: [
            {
              name: "CodeQL",
              head_sha: "head-sha",
              status: "completed",
              conclusion: "success",
            },
          ],
        });
      }
      return Promise.resolve([]);
    });

    const result = await createGitHubCodeScanningProvider(providerOptions(request)).analyze(
      "pr-id",
    );

    expect(result.findings).toEqual([]);
    expect(result.evidence[0]).toMatchObject({
      source: "GitHub Code Scanning / CodeQL",
      result: "PASS",
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("reports current-head alerts as findings and FAIL evidence", async () => {
    const request = vi.fn((path: string) => {
      if (path.includes("/check-runs")) {
        return Promise.resolve({
          check_runs: [
            {
              name: "CodeQL",
              head_sha: "head-sha",
              status: "completed",
              conclusion: "success",
            },
          ],
        });
      }
      return Promise.resolve([
        {
          number: 7,
          html_url: "https://github.com/acme/payments/security/code-scanning/7",
          state: "open",
          rule: {
            id: "js/sql-injection",
            description: "Potential SQL injection",
            security_severity_level: "high",
          },
          most_recent_instance: {
            commit_sha: "head-sha",
            message: { text: "Untrusted input reaches a SQL query." },
            location: { path: "src/query.ts", start_line: 27 },
          },
        },
      ]);
    });

    const result = await createGitHubCodeScanningProvider(providerOptions(request)).analyze(
      "pr-id",
    );

    expect(result.findings).toMatchObject([
      {
        providerFindingId: "7",
        category: "SAST",
        severity: "HIGH",
        title: "Potential SQL injection",
        file: "src/query.ts",
        line: 27,
      },
    ]);
    expect(result.evidence[0]?.result).toBe("FAIL");
  });

  it("does not treat missing or unsuccessful CodeQL runs as a clean scan", async () => {
    const request = vi.fn().mockResolvedValue({ check_runs: [] });

    const result = await createGitHubCodeScanningProvider(providerOptions(request)).analyze(
      "pr-id",
    );

    expect(result.evidence[0]).toMatchObject({
      result: "NOT_RUN",
      metadata: {
        reason: "No completed CodeQL check was found for this pull request head commit.",
      },
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("ignores findings reported against an older commit", async () => {
    const request = vi.fn((path: string) => {
      if (path.includes("/check-runs")) {
        return Promise.resolve({
          check_runs: [
            {
              name: "CodeQL",
              head_sha: "head-sha",
              status: "completed",
              conclusion: "success",
            },
          ],
        });
      }
      return Promise.resolve([
        {
          number: 7,
          state: "open",
          rule: { id: "js/sql-injection", description: "Potential SQL injection" },
          most_recent_instance: { commit_sha: "previous-sha" },
        },
      ]);
    });

    const result = await createGitHubCodeScanningProvider(providerOptions(request)).analyze(
      "pr-id",
    );

    expect(result.findings).toEqual([]);
    expect(result.evidence[0]?.result).toBe("PASS");
  });
});
