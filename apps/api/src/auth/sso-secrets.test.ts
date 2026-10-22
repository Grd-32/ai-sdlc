import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptSsoSecret, encryptSsoSecret } from "./sso-secrets.js";

const validKey = Buffer.alloc(32, 7).toString("base64");
const previousKey = process.env["SSO_ENCRYPTION_KEY"];

describe("SSO secret encryption", () => {
  beforeEach(() => {
    process.env["SSO_ENCRYPTION_KEY"] = validKey;
  });

  afterEach(() => {
    if (previousKey === undefined) delete process.env["SSO_ENCRYPTION_KEY"];
    else process.env["SSO_ENCRYPTION_KEY"] = previousKey;
  });

  it("round-trips client secrets without reusing an initialization vector", () => {
    const first = encryptSsoSecret("oidc-client-secret");
    const second = encryptSsoSecret("oidc-client-secret");

    expect(first).not.toBe(second);
    expect(decryptSsoSecret(first)).toBe("oidc-client-secret");
  });

  it("rejects empty secrets and missing or malformed encryption keys", () => {
    expect(() => encryptSsoSecret("")).toThrow("cannot be empty");
    delete process.env["SSO_ENCRYPTION_KEY"];
    expect(() => encryptSsoSecret("secret")).toThrow("is required");
    process.env["SSO_ENCRYPTION_KEY"] = Buffer.alloc(16).toString("base64");
    expect(() => encryptSsoSecret("secret")).toThrow("32-byte key");
  });

  it("rejects unsupported or tampered envelopes", () => {
    const encrypted = encryptSsoSecret("client-secret");
    expect(() => decryptSsoSecret(`v2${encrypted.slice(2)}`)).toThrow("unsupported");

    const parts = encrypted.split(".");
    const encodedCiphertext = parts[3];
    if (!encodedCiphertext) throw new Error("Expected encrypted payload.");
    const ciphertext = Buffer.from(encodedCiphertext, "base64url");
    const firstByte = ciphertext.at(0);
    if (firstByte === undefined) throw new Error("Expected non-empty encrypted payload.");
    ciphertext[0] = firstByte ^ 1;
    parts[3] = ciphertext.toString("base64url");
    expect(() => decryptSsoSecret(parts.join("."))).toThrow();
  });
});
