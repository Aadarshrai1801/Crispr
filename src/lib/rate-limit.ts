import { NextResponse } from "next/server";

/**
 * Blocker #4: in-process token-bucket rate limiting. Single-node by design
 * (SQLite/LanceDB on local disk), so an in-memory store is correct here — no
 * external dependency needed. Every LLM-triggering or public endpoint must go
 * through this before doing paid/compute-heavy work.
 */

function numEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface RateTier {
  limit: number;
  windowMs: number;
}

/** Named tiers; all overridable via env (per minute). */
const TIERS: Record<string, RateTier> = {
  llmQuery: { limit: numEnv("RATE_LIMIT_QUERY_PER_MIN", 20), windowMs: 60_000 },
  write: { limit: numEnv("RATE_LIMIT_WRITE_PER_MIN", 30), windowMs: 60_000 },
  auth: { limit: numEnv("RATE_LIMIT_AUTH_PER_MIN", 10), windowMs: 60_000 },
};

declare global {
  var __crispRateBuckets: Map<string, { tokens: number; updatedAt: number }> | undefined;
}

function buckets(): Map<string, { tokens: number; updatedAt: number }> {
  globalThis.__crispRateBuckets ??= new Map();
  return globalThis.__crispRateBuckets;
}

export interface RateLimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Consume one token for `key` from the given tier's bucket.
 * Buckets start full and refill continuously across the window.
 */
export function checkRateLimit(key: string, tierName: keyof typeof TIERS): RateLimitResult {
  const tier = TIERS[tierName];
  const refillPerMs = tier.limit / tier.windowMs;
  const now = Date.now();
  const store = buckets();
  const bucket = store.get(key);

  let tokens = tier.limit;
  let updatedAt = now;
  if (bucket) {
    tokens = Math.min(tier.limit, bucket.tokens + (now - bucket.updatedAt) * refillPerMs);
    updatedAt = now;
  }

  const ok = tokens >= 1;
  if (ok) tokens -= 1;
  store.set(key, { tokens, updatedAt });

  // Opportunistic cleanup so the map cannot grow without bound:
  // drop buckets idle for more than 10x the longest window.
  if (store.size > 10_000) {
    const idleCutoff = now - 600_000;
    for (const [k, b] of store) {
      if (b.updatedAt < idleCutoff) store.delete(k);
    }
  }

  return {
    ok,
    limit: tier.limit,
    remaining: Math.floor(tokens),
    retryAfterSeconds: ok ? 0 : Math.max(1, Math.ceil((1 - tokens) / refillPerMs / 1000)),
  };
}

export function rateLimitResponse(result: RateLimitResult): NextResponse {
  return NextResponse.json(
    {
      error: "rate_limited",
      message: `Too many requests. Limit: ${result.limit} per minute. Retry after ${result.retryAfterSeconds}s.`,
    },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } }
  );
}

/** Best-effort client IP for unauthenticated endpoints (login, Slack, public API). */
export function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
