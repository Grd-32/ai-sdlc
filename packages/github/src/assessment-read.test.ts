import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearInstallationTokenCache,
  getGitHubBranchProtection,
  listGitHubCodeScanningAlerts,
  listGitHubDependabotAlerts,
  listGitHubSecretScanningAlerts,
} from "./client.js";

const originalEnvironment = {
  appId: process.env["GITHUB_APP_ID"],
  privateKey: process.env["GITHUB_APP_PRIVATE_KEY"],
  privateKeyBase64: process.env["GITHUB_APP_PRIVATE_KEY_BASE64"],
  baseUrl: process.env["GITHUB_APP_BASE_URL"],
};

afterEach(() => {
  clearInstallationTokenCache();
  vi.unstubAllGlobals();
  if (originalEnvironment.appId === undefined) delete process.env["GITHUB_APP_ID"];
  else process.env["GITHUB_APP_ID"] = originalEnvironment.appId;
  if (originalEnvironment.privateKey === undefined) delete process.env["GITHUB_APP_PRIVATE_KEY"];
  else process.env["GITHUB_APP_PRIVATE_KEY"] = originalEnvironment.privateKey;
  if (originalEnvironment.privateKeyBase64 === undefined)
    delete process.env["GITHUB_APP_PRIVATE_KEY_BASE64"];
  else process.env["GITHUB_APP_PRIVATE_KEY_BASE64"] = originalEnvironment.privateKeyBase64;
  if (originalEnvironment.baseUrl === undefined) delete process.env["GITHUB_APP_BASE_URL"];
  else process.env["GITHUB_APP_BASE_URL"] = originalEnvironment.baseUrl;
});

describe("GitHub assessment read integrations", () => {
  it("returns sanitized repository-wide Code Scanning alerts", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env["GITHUB_APP_ID"] = "test-app";
    process.env["GITHUB_APP_PRIVATE_KEY"] = privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();
    delete process.env["GITHUB_APP_PRIVATE_KEY_BASE64"];
    process.env["GITHUB_APP_BASE_URL"] = "https://api.github.com";

    const mockFetch = vi.fn((input: URL | string) => {
      const url = String(input);
      if (url.endsWith("/access_tokens")) {
        return new Response(
          JSON.stringify({ token: "test-install-token", expires_at: "2099-01-01T00:00:00Z" }),
        );
      }
      return new Response(
        JSON.stringify([
          {
            number: 8,
            html_url: "https://github.com/acme/app/security/code-scanning/8",
            state: "open",
            rule: { description: "Unsafe input", security_severity_level: "high" },
            most_recent_instance: { location: { path: "src/api.ts", start_line: 12 } },
            secret: "not included in returned alert",
          },
        ]),
      );
    });
    vi.stubGlobal("fetch", mockFetch);

    const alerts = await listGitHubCodeScanningAlerts("42", "acme", "app");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/code-scanning/alerts?state=open"),
      expect.anything(),
    );
    expect(alerts).toEqual([
      {
        number: 8,
        html_url: "https://github.com/acme/app/security/code-scanning/8",
        state: "open",
        title: "Unsafe input",
        severity: "high",
        file: "src/api.ts",
        line: 12,
      },
    ]);
  });

  it("returns sanitized repository-wide Dependabot alerts", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env["GITHUB_APP_ID"] = "test-app";
    process.env["GITHUB_APP_PRIVATE_KEY"] = privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();
    delete process.env["GITHUB_APP_PRIVATE_KEY_BASE64"];
    process.env["GITHUB_APP_BASE_URL"] = "https://api.github.com";

    const mockFetch = vi.fn((input: URL | string) => {
      const url = String(input);
      if (url.endsWith("/access_tokens")) {
        return new Response(
          JSON.stringify({ token: "test-install-token", expires_at: "2099-01-01T00:00:00Z" }),
        );
      }
      return new Response(
        JSON.stringify([
          {
            number: 9,
            html_url: "https://github.com/acme/app/security/dependabot/9",
            state: "open",
            created_at: "2026-10-11T00:00:00Z",
            dependency: {
              package: { name: "example-package" },
              manifest_path: "package.json",
            },
            security_advisory: { summary: "Example vulnerability", severity: "high" },
            security_vulnerability: { severity: "critical" },
            secret: "not included in returned alert",
          },
        ]),
      );
    });
    vi.stubGlobal("fetch", mockFetch);

    const alerts = await listGitHubDependabotAlerts("42", "acme", "app");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/dependabot/alerts?state=open"),
      expect.anything(),
    );
    expect(alerts).toEqual([
      {
        number: 9,
        html_url: "https://github.com/acme/app/security/dependabot/9",
        state: "open",
        packageName: "example-package",
        manifestPath: "package.json",
        summary: "Example vulnerability",
        severity: "critical",
        createdAt: "2026-10-11T00:00:00Z",
      },
    ]);
  });

  it("does not return a secret-scanning alert's secret value", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env["GITHUB_APP_ID"] = "test-app";
    process.env["GITHUB_APP_PRIVATE_KEY"] = privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();
    delete process.env["GITHUB_APP_PRIVATE_KEY_BASE64"];
    process.env["GITHUB_APP_BASE_URL"] = "https://api.github.com";

    vi.stubGlobal(
      "fetch",
      vi.fn((input: URL | string) => {
        const url = String(input);
        if (url.endsWith("/access_tokens")) {
          return new Response(
            JSON.stringify({ token: "test-install-token", expires_at: "2099-01-01T00:00:00Z" }),
          );
        }
        return new Response(
          JSON.stringify([
            {
              number: 7,
              html_url: "https://github.com/acme/app/security/secret-scanning/7",
              state: "open",
              secret_type: "generic_api_key",
              secret_type_display_name: "Generic API Key",
              created_at: "2026-10-12T00:00:00Z",
              updated_at: "2026-10-12T00:00:00Z",
              resolution: null,
              secret: "must-never-leave-provider-response",
            },
          ]),
        );
      }),
    );

    const alerts = await listGitHubSecretScanningAlerts("42", "acme", "app");
    expect(alerts).toEqual([
      expect.objectContaining({ number: 7, secret_type: "generic_api_key" }),
    ]);
    expect(alerts[0]).not.toHaveProperty("secret");
  });

  it("reports branch-protection permissions failures as unknown, not disabled", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env["GITHUB_APP_ID"] = "test-app";
    process.env["GITHUB_APP_PRIVATE_KEY"] = privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();
    delete process.env["GITHUB_APP_PRIVATE_KEY_BASE64"];
    process.env["GITHUB_APP_BASE_URL"] = "https://api.github.com";
    vi.stubGlobal(
      "fetch",
      vi.fn((input: URL | string) => {
        if (String(input).endsWith("/access_tokens")) {
          return new Response(
            JSON.stringify({ token: "test-install-token", expires_at: "2099-01-01T00:00:00Z" }),
          );
        }
        return new Response("Resource not accessible by integration", { status: 403 });
      }),
    );

    await expect(getGitHubBranchProtection("42", "acme", "app", "main")).resolves.toMatchObject({
      status: "UNKNOWN",
    });
  });
});
