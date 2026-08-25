import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Session authentication primitives (blocker #1).
 *
 * Identity used to come from a client-supplied x-crisp-user-id header — trivial
 * to spoof. It now comes from an HttpOnly session cookie backed by a SQLite
 * session store. This module is intentionally free of DB imports so db.ts can
 * use hashPassword() without a circular dependency.
 */

export const SESSION_COOKIE = "crisp_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Replay-window style cap reused for login brute-force throttling keys. */
export const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt:${salt.toString("base64url")}:${key.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  try {
    const salt = Buffer.from(parts[1], "base64url");
    const expected = Buffer.from(parts[2], "base64url");
    const actual = scryptSync(password, salt, expected.length);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const pair of header.split(";")) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}
