import { NextResponse } from "next/server";
import { z } from "zod";
import { originalDocumentAnswer } from "@/lib/retrieval";
import { LlmNotConfiguredError } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BodySchema = z.object({
  query_log_id: z.string().optional(),
  question: z.string().min(3).max(2000).optional(),
  document_ids: z.array(z.string()).min(1),
}).refine((b) => b.question || b.query_log_id, { message: "Provide question or query_log_id" });

/** FR-24 transparency: on-demand document-derived answer alongside any correction. */
export async function POST(request: Request) {
  try {
    const body = BodySchema.parse(await request.json());
    let question = body.question ?? "";
    if (!question && body.query_log_id) {
      const { getQueryLog } = await import("@/lib/db");
      question = getQueryLog(body.query_log_id)?.question_text ?? "";
    }
    if (!question) return NextResponse.json({ error: "Could not resolve question" }, { status: 400 });

    const payload = await originalDocumentAnswer("ws_default", body.document_ids, question);
    return NextResponse.json(payload);
  } catch (err) {
    if (err instanceof LlmNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request", details: err.issues }, { status: 400 });
    }
    console.error("[query.original]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
