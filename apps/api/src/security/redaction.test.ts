import { describe, expect, it } from "vitest";
import { redactSensitiveFields, redactSensitiveJsonContainer } from "./redaction.js";

describe("redactSensitiveFields", () => {
  it("removes sensitive properties recursively from objects and arrays", () => {
    const value = {
      id: "provider-1",
      metadata: {
        endpoint: "https://idp.example.test",
        clientSecret: "client-secret",
        nested: [{ accessKey: "access-key", label: "safe" }],
      },
      apiKeys: [{ keyHash: "stored-hash", name: "automation" }],
      scimTokens: [{ tokenHash: "stored-token-hash" }],
      auditMetadata: {
        previousHash: "previous-integrity-hash",
        integrityHash: "event-integrity-hash",
        keyHash: "secret-key-hash",
      },
      refresh_token: "refresh-token",
      privateKey: "private-key",
    };

    expect(redactSensitiveFields(value)).toEqual({
      id: "provider-1",
      metadata: {
        endpoint: "https://idp.example.test",
        nested: [{ label: "safe" }],
      },
      apiKeys: [{ name: "automation" }],
      scimTokens: [{}],
      auditMetadata: {
        previousHash: "previous-integrity-hash",
        integrityHash: "event-integrity-hash",
      },
    });
  });

  it("preserves dates and ordinary scalar values", () => {
    const createdAt = new Date("2026-10-09T12:00:00.000Z");

    expect(redactSensitiveFields({ createdAt, enabled: true, count: 2 })).toEqual({
      createdAt,
      enabled: true,
      count: 2,
    });
  });

  it("returns a JSON-safe sanitized container for identity-provider metadata", () => {
    expect(
      redactSensitiveJsonContainer({
        clientId: "public-client",
        clientSecret: "must-not-persist",
        attributes: [{ accessToken: "must-not-persist", claim: "email" }],
      }),
    ).toEqual({
      clientId: "public-client",
      attributes: [{ claim: "email" }],
    });
  });
});
