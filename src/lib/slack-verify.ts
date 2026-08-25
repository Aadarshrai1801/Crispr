import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Blocker #2: Slack request signature verification.
 * https://api.slack.com/authentication/verifying-requests-from-slack
 *
 * baseString = `v0:{timestamp}:{rawBody}`
 * expected   = `v0=` + HMAC-SHA256(signingSecret, baseString) hex
 */

/** Replay window per Slack's recommendation. */
export const SLACK_MAX_SKEW_SECONDS = 5 * 60;

export interface SlackSignatureInput {
  signingSecret: string;
  /** X-Slack-Request-Timestamp header value. */
  timestamp: string;
  /** Raw request body (exact bytes as received). */
  body: string;
  /** X-Slack-Signature header value (`v0=<hex>`). */
  signature: string;
  /** Injectable clock for tests. */
  nowSeconds?: number;
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function computeSlackSignature(signingSecret: string, timestamp: string, body: string): string {
  const base = `v0:${timestamp}:${body}`;
  return "v0=" + createHmac("sha256", signingSecret).update(base, "utf8").digest("hex");
}

/** Returns null when the request is authentic and fresh, else a rejection reason. */
export function verifySlackSignature(input: SlackSignatureInput): string | null {
  const { signingSecret, timestamp, body, signature, nowSeconds } = input;
  if (!signingSecret) return "SLACK_SIGNING_SECRET is not configured";
  if (!timestamp || !signature) return "missing signature headers";

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return "malformed timestamp";
  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > SLACK_MAX_SKEW_SECONDS) return "timestamp outside replay window";

  const expected = computeSlackSignature(signingSecret, timestamp, body);
  if (!safeEqual(expected, signature)) return "signature mismatch";
  return null;
}
