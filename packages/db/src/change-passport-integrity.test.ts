import { describe, expect, it } from "vitest";
import {
  hashChangePassportRevision,
  verifyChangePassportRevisionChain,
  type ChangePassportRevisionEnvelope,
} from "./change-passport-integrity.js";

describe("Change Passport revision integrity", () => {
  it("canonicalizes object key order and verifies a revision chain", () => {
    const payload = { change: { number: 5, title: "change" }, provenance: "UNKNOWN" };
    const reorderedPayload = {
      provenance: "UNKNOWN",
      change: { title: "change", number: 5 },
    };
    const first: ChangePassportRevisionEnvelope = {
      passportId: "passport-1",
      organizationId: "org-1",
      schemaVersion: 1,
      revision: 1,
      previousHash: null,
      createdAt: "2026-10-16T00:00:00.000Z",
      payload: reorderedPayload,
      evidenceSnapshot: { commitShas: ["abc"] },
    };
    const firstHash = hashChangePassportRevision(first);
    const second: ChangePassportRevisionEnvelope = {
      ...first,
      revision: 2,
      previousHash: firstHash,
      createdAt: "2026-10-16T01:00:00.000Z",
      payload,
    };
    expect(hashChangePassportRevision(first)).toBe(
      hashChangePassportRevision({ ...first, payload }),
    );
    expect(
      verifyChangePassportRevisionChain([
        { ...first, contentHash: firstHash },
        { ...second, contentHash: hashChangePassportRevision(second) },
      ]),
    ).toEqual({ valid: true, checked: 2, reason: null });
  });

  it("reports content mutation and broken previous-hash links", () => {
    const envelope: ChangePassportRevisionEnvelope = {
      passportId: "passport-1",
      organizationId: "org-1",
      schemaVersion: 1,
      revision: 1,
      previousHash: null,
      createdAt: "2026-10-16T00:00:00.000Z",
      payload: { result: "PASS" },
      evidenceSnapshot: { evidenceCount: 1 },
    };
    const revision = { ...envelope, contentHash: hashChangePassportRevision(envelope) };
    expect(
      verifyChangePassportRevisionChain([{ ...revision, payload: { result: "FAIL" } }]),
    ).toMatchObject({ valid: false, reason: "CONTENT_HASH_MISMATCH" });
    expect(
      verifyChangePassportRevisionChain([{ ...revision, previousHash: "wrong" }]),
    ).toMatchObject({ valid: false, reason: "PREVIOUS_HASH_MISMATCH" });
  });
});
