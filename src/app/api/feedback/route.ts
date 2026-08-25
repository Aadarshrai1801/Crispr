import { NextResponse } from "next/server";
import { z } from "zod";
import { setFeedbackStatus, incrementCorrectionStats, getQueryLog } from "@/lib/db";
import { scheduleRepeatedFlagAnalysis } from "@/lib/ingest-hooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  query_log_id: z.string(),
  verdict: z.enum(["flagged", "confirmed_correct"]),
  correction_id: z.string().optional(),
});

export async function POST(request: Request) {
  const body = BodySchema.parse(await request.json());
  const log = getQueryLog(body.query_log_id);
  if (!log) return NextResponse.json({ error: "Query log not found" }, { status: 404 });

  setFeedbackStatus(body.query_log_id, body.verdict);

  // "Did this answer your question?" confirmations strengthen the served correction
  if (body.verdict === "confirmed_correct" && (log.correction_id || body.correction_id)) {
    incrementCorrectionStats(log.correction_id ?? body.correction_id!, "confirmed_count");
  }

  // FR-51: a new flag may complete a repeated-question pattern — re-analyze (debounced).
  if (body.verdict === "flagged") {
    scheduleRepeatedFlagAnalysis(log.workspace_id);
  }

  return NextResponse.json({ ok: true });
}
