import { createHash } from "node:crypto";

export interface ChangePassportRevisionEnvelope {
  passportId: string;
  organizationId: string;
  schemaVersion: number;
  revision: number;
  previousHash: string | null;
  createdAt: string;
  payload: unknown;
  evidenceSnapshot: unknown;
}

export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

export function hashChangePassportRevision(envelope: ChangePassportRevisionEnvelope): string {
  const normalized: ChangePassportRevisionEnvelope = {
    passportId: envelope.passportId,
    organizationId: envelope.organizationId,
    schemaVersion: envelope.schemaVersion,
    revision: envelope.revision,
    previousHash: envelope.previousHash,
    createdAt: envelope.createdAt,
    payload: envelope.payload,
    evidenceSnapshot: envelope.evidenceSnapshot,
  };
  return createHash("sha256").update(canonicalJson(normalized)).digest("hex");
}

export function verifyChangePassportRevisionChain(
  revisions: Array<ChangePassportRevisionEnvelope & { contentHash: string }>,
): { valid: boolean; checked: number; reason: string | null } {
  let previousHash: string | null = null;
  for (let index = 0; index < revisions.length; index += 1) {
    const revision = revisions[index];
    if (!revision) continue;
    if (revision.revision !== index + 1) {
      return { valid: false, checked: index, reason: "REVISION_SEQUENCE_GAP" };
    }
    if (revision.previousHash !== previousHash) {
      return { valid: false, checked: index, reason: "PREVIOUS_HASH_MISMATCH" };
    }
    const expectedHash = hashChangePassportRevision(revision);
    if (revision.contentHash !== expectedHash) {
      return { valid: false, checked: index + 1, reason: "CONTENT_HASH_MISMATCH" };
    }
    previousHash = revision.contentHash;
  }
  return { valid: true, checked: revisions.length, reason: null };
}
