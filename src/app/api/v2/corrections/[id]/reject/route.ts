import { z } from "zod";
import { rejectCorrection } from "@/lib/corrections";
import { getCorrection } from "@/lib/db";
import { requireApprover, requireContext } from "@/lib/rbac";
import { apiError, json } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const BodySchema = z.object({
  reason: z.string().min(3).max(2000),
});

/** PRD API contract: POST /v2/corrections/{id}/reject — with a required reason (FR-33). */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = BodySchema.parse(await request.json());
    const existing = getCorrection(id);
    if (!existing) return json({ error: "Correction not found" }, 404);
    const ctx = requireContext(request, existing.workspace_id);
    requireApprover(ctx);
    const correction = await rejectCorrection(id, ctx.userId, body.reason);
    return json({ correction });
  } catch (err) {
    return apiError(err);
  }
}
