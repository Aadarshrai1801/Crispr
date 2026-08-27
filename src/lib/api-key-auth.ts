import { findApiKeyByHash } from "./db";
import { sha256Hex } from "./crypto-utils";
import type { ApiKeyRow } from "./types";

/**
 * FR-46 public API authentication. Keys look like `cris_<base64url>`; only a
 * SHA-256 hash is stored so a database leak never leaks usable keys. Keys are
 * workspace-scoped and carry explicit scopes ("query", "write").
 */

export interface PublicApiContext {
  key: ApiKeyRow;
  workspace_id: string;
  scopes: string[];
}

export class ApiKeyError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.name = "ApiKeyError";
    this.status = status;
  }
}

export async function authenticateApiKey(request: Request): Promise<PublicApiContext> {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(cris_[A-Za-z0-9_-]+)$/i);
  if (!match) throw new ApiKeyError("Missing or malformed Authorization header. Expected: Bearer cris_...");

  const key = await findApiKeyByHash(sha256Hex(match[1]));
  if (!key) throw new ApiKeyError("Invalid, revoked, or unknown API key.", 401);

  let scopes: string[] = [];
  try {
    scopes = JSON.parse(key.scopes || "[]");
  } catch {
    /* malformed */
  }
  return { key, workspace_id: key.workspace_id, scopes };
}

export function requireScope(ctx: PublicApiContext, scope: "query" | "write") {
  if (!ctx.scopes.includes(scope)) {
    throw new ApiKeyError(`API key lacks the required "${scope}" scope.`, 403);
  }
}
