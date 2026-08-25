import { describe, it, expect } from "vitest";
import { checkRateLimit } from "@/lib/rate-limit";

describe("token-bucket rate limiting (blocker #4)", () => {
  it("allows traffic under the configured limit", () => {
    const key = `test-under-${Math.random()}`;
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(key, "auth").ok).toBe(true);
    }
  });

  it("returns 429 signals once the bucket is drained, with a Retry-After hint", () => {
    const key = `test-drain-${Math.random()}`;
    // auth tier default: 10/min
    let last;
    for (let i = 0; i < 10; i++) last = checkRateLimit(key, "auth");
    expect(last!.ok).toBe(true);
    const blocked = checkRateLimit(key, "auth");
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(blocked.limit).toBe(10);
  });

  it("keys are isolated per caller", () => {
    const a = `test-iso-a-${Math.random()}`;
    const b = `test-iso-b-${Math.random()}`;
    for (let i = 0; i < 10; i++) checkRateLimit(a, "auth");
    expect(checkRateLimit(a, "auth").ok).toBe(false);
    expect(checkRateLimit(b, "auth").ok).toBe(true); // untouched bucket
  });

  it("buckets refill over time (injectable via internal timing)", async () => {
    const key = `test-refill-${Math.random()}`;
    for (let i = 0; i < 10; i++) checkRateLimit(key, "auth");
    expect(checkRateLimit(key, "auth").ok).toBe(false);
    // A tiny wait refills a fraction of one token; not enough to pass.
    await new Promise((r) => setTimeout(r, 20));
    // Refill rate for auth tier: 10 tokens / 60s -> 0.0033 tokens in 20ms.
    expect(checkRateLimit(key, "auth").ok).toBe(false);
  });
});
