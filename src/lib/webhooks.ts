import { randomBytes } from "node:crypto";
import { config } from "./config";
import { hmacSha256Hex } from "./crypto-utils";
import { listWebhookEndpoints } from "./db";
import type { WebhookEndpointRow } from "./types";

/**
 * Signed webhook delivery (PRD API contract): every payload is HMAC-SHA256
 * signed with the per-endpoint secret so receivers can verify authenticity.
 * Delivery is best-effort and never blocks the triggering request.
 */

export const WEBHOOK_EVENTS = [
  "correction.submitted",
  "correction.approved",
  "correction.rejected",
  "conflict.detected",
  "document.version_updated",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export function newWebhookSecret(): string {
  return "whsec_" + randomBytes(24).toString("base64url");
}

interface DispatchPayload {
  event: WebhookEvent;
  workspace_id: string;
  data: Record<string, unknown>;
}

function sign(secret: string, timestamp: string, body: string): string {
  return `t=${timestamp},v1=${hmacSha256Hex(secret, `${timestamp}.${body}`)}`;
}

async function deliver(endpoint: WebhookEndpointRow, payload: DispatchPayload) {
  const body = JSON.stringify({
    id: "evt_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    ...payload,
    sent_at: new Date().toISOString(),
  });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.webhookTimeoutMs);
    await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Crisp-Event": payload.event,
        "X-Crisp-Signature": sign(endpoint.secret, timestamp, body),
        "X-Crisp-Timestamp": timestamp,
      },
      body,
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
  } catch (err) {
    console.warn(`[webhooks] delivery to ${endpoint.url} failed:`, err instanceof Error ? err.message : err);
  }
}

/** Fire-and-forget dispatch to all active endpoints subscribed to the event. */
export function dispatchWebhook(event: WebhookEvent, workspaceId: string, data: Record<string, unknown>) {
  try {
    const endpoints = listWebhookEndpoints(workspaceId).filter(
      (e) => e.active === 1 && (JSON.parse(e.events || "[]") as string[]).includes(event)
    );
    for (const endpoint of endpoints) {
      void deliver(endpoint, { event, workspace_id: workspaceId, data });
    }
  } catch (err) {
    console.warn("[webhooks] dispatch failed:", err);
  }
}
