import { z } from "zod";
import { reviewCorrectionEdit } from "@/lib/corrections";
import { getCorrection } from "@/lib/db";
import { requireApprover, requireContext } from "@/lib/rbac";
import { apiError, json } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const BodySchema = z.object({
  decision: z.enum(["accept", "reject"]),
  reason: z.string().max(1000).optional(),
});

/**
 * Approver/Admin decision on a proposed correction edit (role-gated edits).
 * The previous answer stays live and visible until an acceptance applies it.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = BodySchema.parse(await request.json());
    const existing = await getCorrection(id);
    if (!existing) return json({ error: "Correction not found" }, 404);
    const ctx = await requireContext(request, existing.workspace_id);
    requireApprover(ctx);
    const correction = await reviewCorrectionEdit(id, body.decision, ctx.userId, body.reason);
    return json({ correction });
  } catch (err) {
    return apiError(err);
  }
}
