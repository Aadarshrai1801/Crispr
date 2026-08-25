import { NextResponse } from "next/server";
import { z } from "zod";
import { correctionHistory, editCorrection, retireCorrection } from "@/lib/corrections";
import { getCorrection, setNeedsVersionReview } from "@/lib/db";
import { requireContext, requireContributor } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

const PatchSchema = z.object({
  action: z.enum(["edit", "retire", "version_review_keep", "version_review_reflag"]),
  question_text: z.string().min(3).max(2000).optional(),
  corrected_answer_text: z.string().min(2).max(8000).optional(),
  note: z.string().max(4000).nullable().optional(),
  topic_tags: z.array(z.string()).max(10).optional(),
  scope: z.enum(["document", "workspace"]).optional(),
});

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const row = getCorrection(id);
  if (!row) return NextResponse.json({ error: "Correction not found" }, { status: 404 });
  try {
    await requireContext(request, row.workspace_id);
  } catch (err) {
    return apiError(err);
  }
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
    const existing = getCorrection(id);
    if (!existing) return NextResponse.json({ error: "Correction not found" }, { status: 404 });

    // FR-34: editing requires Contributor+; every action is audited.
    const ctx = requireContext(request, existing.workspace_id);
    requireContributor(ctx);

    if (body.action === "retire") {
      const retired = await retireCorrection(id, ctx.userId);
      return NextResponse.json(retired);
    }

    if (body.action === "version_review_keep") {
      // FR-39 review outcome: correction still applies to the new version.
      setNeedsVersionReview(id, false);
      audit.write(existing.workspace_id, ctx.userId, "correction.edited", "correction", id, { needs_version_review: true }, { needs_version_review: false, review_outcome: "still_applies" });
      return NextResponse.json(getCorrection(id));
    }

    if (body.action === "version_review_reflag") {
      // FR-39 review outcome: keep it live but annotate that it was re-flagged for the new version.
      setNeedsVersionReview(id, false);
      audit.write(existing.workspace_id, ctx.userId, "correction.edited", "correction", id, { needs_version_review: true }, { needs_version_review: false, review_outcome: "reflagged_note_added" });
      const updated = await editCorrection(id, {
        note: `${existing.note ? existing.note + " · " : ""}Re-flagged after document version update`,
        actor_id: ctx.userId,
      });
      return NextResponse.json(updated);
    }

    const updated = await editCorrection(id, {
      question_text: body.question_text,
      corrected_answer_text: body.corrected_answer_text,
      note: body.note === undefined ? undefined : body.note,
      topic_tags: body.topic_tags,
      scope: body.scope,
      actor_id: ctx.userId,
    });
    return NextResponse.json(updated);
  } catch (err) {
    return apiError(err);
  }
}
