import { describe, it, expect } from "vitest";
import {
  GITHUB_PACKAGE_VERSION,
  computeGitHubWebhookSignature,
  getGitHubAppConfig,
  mapInstallationToOrganization,
  normalizeRepositoryDiscovery,
  verifyWebhookSignature,
} from "./index.js";

describe("@ai-sdlc/github", () => {
  it("exports package version", () => {
    expect(GITHUB_PACKAGE_VERSION).toBe("0.1.0");
  });

  it("reads GitHub App config from environment", () => {
    process.env["GITHUB_APP_ID"] = "123";
    process.env["GITHUB_APP_CLIENT_ID"] = "client-id";
    process.env["GITHUB_WEBHOOK_SECRET"] = "super-secret";

    expect(getGitHubAppConfig()).toMatchObject({
      appId: "123",
      clientId: "client-id",
      webhookSecret: "super-secret",
    });
  });

  it("verifies a valid webhook signature", () => {
    const payload = JSON.stringify({ action: "opened", installation: { id: 42 } });
    const secret = "webhook-secret";
    const signature = computeGitHubWebhookSignature(payload, secret);

    expect(verifyWebhookSignature(payload, signature, secret)).toBe(true);
    expect(verifyWebhookSignature(payload, "sha256=deadbeef", secret)).toBe(false);
  });

  it("maps an installation to the owning organization", () => {
    expect(
      mapInstallationToOrganization("install-123", "org-456", {
        appId: "app-1",
        accountLogin: "acme",
        accountType: "Organization",
      }),
    ).toMatchObject({
      id: "install-123",
      organizationId: "org-456",
      accountLogin: "acme",
      accountType: "Organization",
    });
  });

  it("normalizes repository discovery payloads for the organization", () => {
    expect(
      normalizeRepositoryDiscovery(
        {
          id: 99,
          name: "payments-api",
          full_name: "acme/payments-api",
          owner: { login: "acme" },
          default_branch: "main",
          private: true,
        },
        "org-456",
      ),
    ).toMatchObject({
      provider: "GITHUB",
      organizationId: "org-456",
      owner: "acme",
      fullName: "acme/payments-api",
      enabled: true,
      defaultBranch: "main",
    });
  });
});
