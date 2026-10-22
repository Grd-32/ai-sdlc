import { afterEach, describe, expect, it } from "vitest";
import {
  decryptGitLabCredentials,
  decryptSourceControlSecret,
  encryptGitLabCredentials,
  encryptSourceControlSecret,
} from "./credentials.js";

const originalKey = process.env["SOURCE_CONTROL_ENCRYPTION_KEY"];

afterEach(() => {
  if (originalKey === undefined) {
    delete process.env["SOURCE_CONTROL_ENCRYPTION_KEY"];
  } else {
    process.env["SOURCE_CONTROL_ENCRYPTION_KEY"] = originalKey;
  }
});

describe("source-control credential encryption", () => {
  it("encrypts and decrypts GitLab OAuth tokens with authenticated encryption", () => {
    process.env["SOURCE_CONTROL_ENCRYPTION_KEY"] = Buffer.alloc(32, 7).toString("base64");
    const credentials = {
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
      expiresAt: "2026-10-14T12:00:00.000Z",
    };

    const envelope = encryptGitLabCredentials(credentials);

    expect(envelope).not.toContain(credentials.accessToken);
    expect(envelope).not.toContain(credentials.refreshToken);
    expect(decryptGitLabCredentials(envelope)).toEqual(credentials);
  });

  it("rejects altered envelopes and missing encryption configuration", () => {
    process.env["SOURCE_CONTROL_ENCRYPTION_KEY"] = Buffer.alloc(32, 7).toString("base64");
    const envelope = encryptGitLabCredentials({
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
      expiresAt: "2026-10-14T12:00:00.000Z",
    });
    const altered = `${envelope.slice(0, -1)}${envelope.endsWith("a") ? "b" : "a"}`;

    expect(() => decryptGitLabCredentials(altered)).toThrow();
    delete process.env["SOURCE_CONTROL_ENCRYPTION_KEY"];
    expect(() =>
      encryptGitLabCredentials({
        accessToken: "access-secret",
        refreshToken: "refresh-secret",
        expiresAt: "2026-10-14T12:00:00.000Z",
      }),
    ).toThrow("SOURCE_CONTROL_ENCRYPTION_KEY");
  });

  it("encrypts webhook signing secrets at rest", () => {
    process.env["SOURCE_CONTROL_ENCRYPTION_KEY"] = Buffer.alloc(32, 9).toString("base64");
    const secret = "bitbucket-webhook-secret";
    const encrypted = encryptSourceControlSecret(secret);

    expect(encrypted).not.toContain(secret);
    expect(decryptSourceControlSecret(encrypted)).toBe(secret);
    expect(() => decryptSourceControlSecret(`${encrypted.slice(0, -1)}x`)).toThrow();
  });
});
