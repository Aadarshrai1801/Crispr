import { z } from "zod";
import { acceptSuggestion, dismissSuggestion } from "@/lib/suggestions";
import { getCorrection, getSuggestedCorrection } from "@/lib/db";
import { requireApprover, requireContext } from "@/lib/rbac";
import { apiError, json } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const BodySchema = z.object({
  action: z.enum(["accept", "dismiss"]),
  corrected_answer: z.string().min(2).max(8000).optional(),
  document_id: z.string().nullable().optional(),
});

/** Accept (creates a correction through the normal approval gate) or dismiss a suggestion. */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = BodySchema.parse(await request.json());
    const suggestion = await getSuggestedCorrection(id);
    if (!suggestion) return json({ error: "Suggestion not found" }, 404);
    const ctx = await requireContext(request, suggestion.workspace_id);
    requireApprover(ctx);

    if (body.action === "dismiss") {
      await dismissSuggestion(id, ctx.userId);
      return json({ ok: true, dismissed: true });
    }

    const correction = await acceptSuggestion(id, ctx.userId, {
      corrected_answer: body.corrected_answer,
      document_id: body.document_id ?? undefined,
      submitterRole: ctx.role,
    });
    return json({ correction }, 201);
  } catch (err) {
    if (err instanceof Error && err.message.includes("no draft answer")) {
      return json({ error: err.message }, 422);
    }
    return apiError(err);
  }
}

export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    void getCorrection;
    const suggestion = await getSuggestedCorrection(id);
    if (!suggestion) return json({ error: "Suggestion not found" }, 404);
    await requireContext(request, suggestion.workspace_id);
    return json({ suggestion });
  } catch (err) {
    return apiError(err);
  }
}
