import crypto from "node:crypto";
import { env } from "./env";

// AES-256-GCM at-rest encryption for User.githubAccessToken — see .ai/rules/security.md
// hardening backlog "GitHub token encryption at rest".
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // recommended IV size for GCM

function getKey(): Buffer {
  return Buffer.from(env.ENCRYPTION_KEY, "hex");
}

// Stored shape: "<iv>:<authTag>:<ciphertext>", each hex-encoded.
export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

export function decrypt(stored: string): string {
  const [ivHex, authTagHex, ciphertextHex] = stored.split(":");
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error("Malformed encrypted payload");
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, "hex")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
