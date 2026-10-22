import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const encoded = process.env["SSO_ENCRYPTION_KEY"];
  if (!encoded) throw new Error("SSO_ENCRYPTION_KEY is required to store SSO client secrets.");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) {
    throw new Error("SSO_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }
  return key;
}

export function encryptSsoSecret(secret: string): string {
  if (!secret) throw new Error("SSO client secret cannot be empty.");
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [
    VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptSsoSecret(envelope: string): string {
  const [version, encodedIv, encodedTag, encodedCiphertext, ...extra] = envelope.split(".");
  if (
    version !== VERSION ||
    !encodedIv ||
    !encodedTag ||
    !encodedCiphertext ||
    extra.length > 0
  ) {
    throw new Error("Stored SSO client secret has an unsupported encryption envelope.");
  }
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(encodedIv, "base64url"));
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
