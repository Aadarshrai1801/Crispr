import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { config } from "./config";

function key(): Buffer {
  return createHash("sha256").update(config.encryptionSecret).digest();
}

/** AES-256-GCM encryption for integration credentials at rest (PRD security requirements). */
export function encryptJson(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${encrypted.toString("base64url")}.${tag.toString("base64url")}`;
}

export function decryptJson<T>(payload: string): T | null {
  try {
    const [version, ivB64, dataB64, tagB64] = payload.split(".");
    if (version !== "v1") return null;
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64url")), decipher.final()]);
    return JSON.parse(decrypted.toString("utf8")) as T;
  } catch {
    return null;
  }
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hmacSha256Hex(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}
