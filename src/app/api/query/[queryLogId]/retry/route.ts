import { NextResponse } from "next/server";
import { answerQuestion } from "@/lib/retrieval";
import { config } from "@/lib/config";
import { defaultUserId, defaultWorkspaceId, getQueryLog } from "@/lib/db";
import { LlmNotConfiguredError } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Params = { params: Promise<{ queryLogId: string }> };

/** POST /api/query/{id}/retry — re-runs with an ADJUSTED strategy (FR-18), capped at MAX_RETRIES (FR-19). */
export async function POST(_request: Request, { params }: Params) {
  try {
    const { queryLogId } = await params;
    const log = getQueryLog(queryLogId);
    if (!log) return NextResponse.json({ error: "Query log not found" }, { status: 404 });

    if (log.attempt >= config.maxRetries) {
      return NextResponse.json(
        {
          error: "retry_exhausted",
          message: `Automatic retries are capped at ${config.maxRetries}. Provide the correct answer directly instead.`,
          max_retries: config.maxRetries,
        },
        { status: 409 }
      );
    }

    const payload = await answerQuestion({
      workspaceId: log.workspace_id || defaultWorkspaceId(),
      userId: log.user_id || defaultUserId(),
      documentIds: JSON.parse(log.document_ids) as string[],
      question: log.question_text,
      parentLog: log,
    });
    return NextResponse.json(payload);
  } catch (err) {
    if (err instanceof LlmNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    console.error("[query.retry]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Retry failed" }, { status: 500 });
  }
}
