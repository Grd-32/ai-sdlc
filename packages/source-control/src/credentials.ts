import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ENCRYPTION_VERSION = "v1";
const ALGORITHM = "aes-256-gcm";

export interface SourceControlOAuthCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export type GitLabOAuthCredentials = SourceControlOAuthCredentials;

function getEncryptionKey(): Buffer {
  const encodedKey = process.env["SOURCE_CONTROL_ENCRYPTION_KEY"];
  if (!encodedKey) {
    throw new Error(
      "SOURCE_CONTROL_ENCRYPTION_KEY must be configured before storing provider credentials.",
    );
  }
  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32 || key.toString("base64") !== encodedKey) {
    throw new Error("SOURCE_CONTROL_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }
  return key;
}

export function validateSourceControlEncryptionKey(): void {
  getEncryptionKey();
}

export function validateGitLabEncryptionKey(): void {
  validateSourceControlEncryptionKey();
}

export function encryptSourceControlCredentials(
  credentials: SourceControlOAuthCredentials,
): string {
  return encryptSourceControlPayload(JSON.stringify(credentials));
}

export function encryptSourceControlSecret(secret: string): string {
  if (!secret) throw new Error("A non-empty source-control secret is required.");
  return encryptSourceControlPayload(secret);
}

function encryptSourceControlPayload(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    ENCRYPTION_VERSION,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function encryptGitLabCredentials(credentials: GitLabOAuthCredentials): string {
  return encryptSourceControlCredentials(credentials);
}

export function decryptSourceControlCredentials(envelope: string): SourceControlOAuthCredentials {
  const value = decryptSourceControlPayload(envelope);
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Stored source-control credentials have an invalid payload.");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("accessToken" in parsed) ||
    typeof parsed.accessToken !== "string" ||
    !("refreshToken" in parsed) ||
    typeof parsed.refreshToken !== "string" ||
    !("expiresAt" in parsed) ||
    typeof parsed.expiresAt !== "string"
  ) {
    throw new Error("Stored source-control credentials have an invalid payload.");
  }
  return {
    accessToken: parsed.accessToken,
    refreshToken: parsed.refreshToken,
    expiresAt: parsed.expiresAt,
  };
}

export function decryptSourceControlSecret(envelope: string): string {
  return decryptSourceControlPayload(envelope);
}

function decryptSourceControlPayload(envelope: string): string {
  const [version, encodedIv, encodedTag, encodedCiphertext, ...unexpected] = envelope.split(".");
  if (
    version !== ENCRYPTION_VERSION ||
    !encodedIv ||
    !encodedTag ||
    !encodedCiphertext ||
    unexpected.length
  ) {
    throw new Error("Stored source-control credentials have an unsupported encryption envelope.");
  }
  const decipher = createDecipheriv(
    ALGORITHM,
    getEncryptionKey(),
    Buffer.from(encodedIv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  return plaintext;
}

export function decryptGitLabCredentials(envelope: string): GitLabOAuthCredentials {
  return decryptSourceControlCredentials(envelope);
}
