import { describe, it, expect } from "vitest";
import { computeSlackSignature, verifySlackSignature, SLACK_MAX_SKEW_SECONDS } from "@/lib/slack-verify";
import { hmacSha256Hex } from "@/lib/crypto-utils";
import { WEBHOOK_EVENTS, newWebhookSecret } from "@/lib/webhooks";

describe("Slack signature verification (blocker #2)", () => {
  const secret = "test-signing-secret";
  const body = "token=xoxb&team_id=T123&text=What+is+the+refund+window%3F";
  // Current wall clock — the replay-window check would otherwise fire first.
  const timestamp = String(Math.floor(Date.now() / 1000));

  it("computes Slack's documented v0 signature format", () => {
    expect(computeSlackSignature(secret, timestamp, body)).toMatch(/^v0=[0-9a-f]{64}$/);
  });

  it("accepts an authentic request", () => {
    const sig = computeSlackSignature(secret, timestamp, body);
    expect(verifySlackSignature({ signingSecret: secret, timestamp, body, signature: sig })).toBeNull();
  });

  it("accepts when the injected clock is inside the replay window", () => {
    const sig = computeSlackSignature(secret, timestamp, body);
    const now = Number(timestamp) + SLACK_MAX_SKEW_SECONDS - 10;
    expect(verifySlackSignature({ signingSecret: secret, timestamp, body, signature: sig, nowSeconds: now })).toBeNull();
  });

  it("rejects a tampered body", () => {
    const sig = computeSlackSignature(secret, timestamp, body);
    const verdict = verifySlackSignature({
      signingSecret: secret,
      timestamp,
      body: body + "&injected=1",
      signature: sig,
    });
    expect(verdict).toContain("mismatch");
  });

  it("rejects a wrong secret", () => {
    const sig = computeSlackSignature("other-secret", timestamp, body);
    expect(verifySlackSignature({ signingSecret: secret, timestamp, body, signature: sig })).toContain("mismatch");
  });

  it("rejects stale timestamps (replay window)", () => {
    const old = String(Number(timestamp) - SLACK_MAX_SKEW_SECONDS - 60);
    const sig = computeSlackSignature(secret, old, body);
    const verdict = verifySlackSignature({
      signingSecret: secret,
      timestamp: old,
      body,
      signature: sig,
      nowSeconds: Number(timestamp),
    });
    expect(verdict).toContain("replay");
  });

  it("rejects missing headers and unconfigured secrets", () => {
    expect(verifySlackSignature({ signingSecret: "", timestamp, body, signature: "v0=00" })).toContain("SLACK_SIGNING_SECRET");
    expect(verifySlackSignature({ signingSecret: secret, timestamp: "", body, signature: "v0=00" })).toContain("missing");
    expect(verifySlackSignature({ signingSecret: secret, timestamp, body, signature: "" })).toContain("missing");
    expect(
      verifySlackSignature({ signingSecret: secret, timestamp: "not-a-number", body, signature: "v0=00" })
    ).toContain("malformed");
  });
});

describe("webhook signing primitives", () => {
  // RFC 4231 test case 2
  it("matches the HMAC-SHA256 RFC test vector", () => {
    expect(hmacSha256Hex("Jefe", "what do ya want for nothing?")).toBe(
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
    );
  });

  it("exposes the documented webhook event names", () => {
    expect(WEBHOOK_EVENTS).toContain("correction.approved");
    expect(WEBHOOK_EVENTS).toContain("conflict.detected");
    expect(newWebhookSecret()).toMatch(/^whsec_[A-Za-z0-9_-]+$/);
  });
});
