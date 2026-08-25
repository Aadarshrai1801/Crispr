import { NextResponse } from "next/server";
import { z } from "zod";
import { submitCorrection } from "@/lib/corrections";
import { listCorrections } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SubmitSchema = z.object({
  query_log_id: z.string(),
  corrected_answer: z.string().min(2).max(8000),
  note: z.string().max(4000).nullable().optional(),
  scope: z.enum(["document", "workspace"]).optional(),
  topic_tags: z.array(z.string()).max(10).optional(),
  resolve: z.enum(["replace", "annotate", "keep"]).optional(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const documentId = url.searchParams.get("document_id") ?? undefined;
  const rows = listCorrections("ws_default", documentId || undefined);
  return NextResponse.json(
    rows.map((r) => ({ ...r, topic_tags: JSON.parse(r.topic_tags || "[]") as string[] }))
  );
}

export async function POST(request: Request) {
  try {
    const body = SubmitSchema.parse(await request.json());
    const result = await submitCorrection({
      query_log_id: body.query_log_id,
      corrected_answer: body.corrected_answer,
      note: body.note ?? null,
      scope: body.scope,
      topic_tags: body.topic_tags,
      resolve: body.resolve,
    });

    if (result.conflictWith && !body.resolve) {
      // FR-28: surface the conflict; client resolves explicitly (FR-29)
      return NextResponse.json(
        {
          conflict: true,
          message: "An active correction for a near-identical question already exists.",
          existing: result.conflictWith,
        },
        { status: 409 }
      );
    }

    return NextResponse.json({ conflict: false, correction: result.correction }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request", details: err.issues }, { status: 400 });
    }
    console.error("[corrections.POST]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to save correction" }, { status: 500 });
  }
}
