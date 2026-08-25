import { NextResponse } from "next/server";
import { z } from "zod";
import { correctionHistory, editCorrection, retireCorrection } from "@/lib/corrections";
import { getCorrection } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

const PatchSchema = z.object({
  action: z.enum(["edit", "retire"]),
  question_text: z.string().min(3).max(2000).optional(),
  corrected_answer_text: z.string().min(2).max(8000).optional(),
  note: z.string().max(4000).nullable().optional(),
  topic_tags: z.array(z.string()).max(10).optional(),
  scope: z.enum(["document", "workspace"]).optional(),
});

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const row = getCorrection(id);
  if (!row) return NextResponse.json({ error: "Correction not found" }, { status: 404 });
  return NextResponse.json({
    ...row,
    topic_tags: JSON.parse(row.topic_tags || "[]") as string[],
    history: correctionHistory(id),
  });
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = PatchSchema.parse(await request.json());

    if (body.action === "retire") {
      const retired = await retireCorrection(id);
      return NextResponse.json(retired);
    }

    const updated = await editCorrection(id, {
      question_text: body.question_text,
      corrected_answer_text: body.corrected_answer_text,
      note: body.note === undefined ? undefined : body.note,
      topic_tags: body.topic_tags,
      scope: body.scope,
    });
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request", details: err.issues }, { status: 400 });
    }
    console.error("[corrections.PATCH]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Update failed" }, { status: 500 });
  }
}
