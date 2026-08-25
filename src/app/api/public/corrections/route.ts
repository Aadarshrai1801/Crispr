import { NextResponse } from "next/server";
import { z } from "zod";
import { submitCorrection } from "@/lib/corrections";
import { getQueryLog } from "@/lib/db";
import { ApiKeyError, authenticateApiKey, requireScope } from "@/lib/api-key-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SubmitSchema = z.object({
  query_log_id: z.string(),
  corrected_answer: z.string().min(2).max(8000),
  note: z.string().max(4000).nullable().optional(),
  scope: z.enum(["document", "workspace"]).optional(),
});

/** FR-46 public API: submit a correction (goes through the workspace approval gate if enabled). */
export async function POST(request: Request) {
  try {
    const ctx = authenticateApiKey(request);
    requireScope(ctx, "write");

    const body = SubmitSchema.parse(await request.json());
    const log = getQueryLog(body.query_log_id);
    if (!log) return NextResponse.json({ error: "Query log not found" }, { status: 404 });
    if (log.workspace_id !== ctx.workspace_id) {
      return NextResponse.json({ error: "Query log belongs to another workspace." }, { status: 403 });
    }

    const result = await submitCorrection({
      query_log_id: body.query_log_id,
      corrected_answer: body.corrected_answer,
      note: body.note ?? null,
      scope: body.scope,
      actor_id: `apikey:${ctx.key.id}`,
    });

    if (result.conflictWith) {
      return NextResponse.json(
        { conflict: true, message: "An active correction for a near-identical question already exists.", existing_id: result.conflictWith.id },
        { status: 409 }
      );
    }

    return NextResponse.json(
      {
        correction: result.correction,
        requires_approval: result.correction.status === "pending",
        authoritative: result.correction.status === "active",
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof ApiKeyError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof z.ZodError) return NextResponse.json({ error: "Invalid request", details: err.issues }, { status: 400 });
    console.error("[public.corrections]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to save correction" }, { status: 500 });
  }
}
