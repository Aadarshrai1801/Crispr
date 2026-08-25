import { NextResponse } from "next/server";
import { answerQuestion } from "@/lib/retrieval";
import { defaultWorkspaceId } from "@/lib/db";
import { config } from "@/lib/config";

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
 * Responses include citations and — per FR-42 — a visible caveat whenever the
 * confidence score falls below the workspace threshold, so low-confidence
 * answers are never treated as authoritative downstream.
 */
export async function POST(request: Request) {
  try {
    const form = await request.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "Expected application/x-www-form-urlencoded" }, { status: 400 });

    const payload = Object.fromEntries(form.entries()) as unknown as Record<string, string>;

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
      userId: request.headers.get("x-crisp-user-id") || "slack_bot",
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
    console.error("[slack.events]", err);
    return NextResponse.json(
      { response_type: "ephemeral", text: "Crisp could not answer right now. Try again shortly." },
      { status: 200 }
    );
  }
}
