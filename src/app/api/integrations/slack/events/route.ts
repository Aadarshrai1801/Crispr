import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { answerQuestion } from "@/lib/retrieval";
import { defaultWorkspaceId } from "@/lib/db";
import { config } from "@/lib/config";
import { verifySlackSignature } from "@/lib/slack-verify";
import { checkRateLimit, clientIp, rateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface SlackCommand {
  command?: string;
  text?: string;
  team_id?: string;
  user_name?: string;
}

/**
 * FR-45: Slack bot endpoint (slash-command style). Point a Slack slash command
 * (e.g. /crisp) at this URL; set SLACK_DEFAULT_WORKSPACE_ID to the workspace
 * whose documents should be queried.
 *
 * Blocker #2: every request is HMAC-verified against SLACK_SIGNING_SECRET with
 * a 5-minute replay window BEFORE the payload is parsed or answered. Requests
 * without a valid signature are rejected with 401.
 *
 * Responses include citations and — per FR-42 — a visible caveat whenever the
 * confidence score falls below the workspace threshold, so low-confidence
 * answers are never treated as authoritative downstream.
 */
export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const rejection = verifySlackSignature({
      signingSecret: config.slackSigningSecret,
      timestamp: request.headers.get("x-slack-request-timestamp") ?? "",
      signature: request.headers.get("x-slack-signature") ?? "",
      body: rawBody,
    });
    if (rejection) {
      return NextResponse.json({ error: `Unauthorized: ${rejection}` }, { status: 401 });
    }

    const limit = checkRateLimit(`slack:${clientIp(request)}`, "llmQuery");
    if (!limit.ok) return rateLimitResponse(limit);

    const payload = Object.fromEntries(new URLSearchParams(rawBody).entries()) as unknown as Record<string, string>;

    // Slack URL verification handshake
    if (payload.type === "url_verification") {
      return NextResponse.json({ challenge: payload.challenge ?? "" });
    }

    const cmd = payload as unknown as SlackCommand;
    const question = (cmd.text ?? "").trim();
    if (!question) {
      return NextResponse.json({
        response_type: "ephemeral",
        text: "Ask a question about the workspace documents, e.g. `/crisp What is the refund window?`",
      });
    }

    const wsId = config.slackDefaultWorkspaceId || defaultWorkspaceId();

    const { readyDocumentIds } = await import("@/lib/retrieval");
    const docIds = readyDocumentIds(wsId);
    if (!docIds.length) {
      return NextResponse.json({ response_type: "in_channel", text: "No documents are ingested in this workspace yet." });
    }

    const result = await answerQuestion({
      workspaceId: wsId,
      userId: "slack_bot",
      documentIds: docIds.slice(0, 50),
      question,
    });

    const caveat =
      result.confidence.flagged_needs_review
        ? "\n:warning: _Low confidence answer — flagged `needs review`. Verify against the source before acting._\n"
        : "";
    const citationLines = result.citations
      .slice(0, 5)
      .map((c) => `• ${(c.document_name ?? c.document_id).replace(/\.pdf$/i, "")} · p.${c.page}`)
      .join("\n");

    return NextResponse.json({
      response_type: "in_channel",
      text: `${caveat}*Q:* ${question}\n*A:* ${result.answer.replace(/\[(\d+)\]/g, "")}${citationLines ? `\n*Citations:*\n${citationLines}` : ""}`,
    });
  } catch (err) {
    logger.error({ err }, "[slack.events]");
    return NextResponse.json(
      { response_type: "ephemeral", text: "Crispr could not answer right now. Try again shortly." },
      { status: 200 }
    );
  }
}
