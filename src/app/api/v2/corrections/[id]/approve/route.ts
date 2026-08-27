import { z } from "zod";
import { approveCorrection } from "@/lib/corrections";
import { requireApprover, requireContext } from "@/lib/rbac";
import { apiError, json } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const BodySchema = z.object({
  /** PRD Risk #1 decision: first-approved-wins. Superseding an existing active
   *  correction requires this explicit opt-in from the Approver. */
  supersede_existing: z.boolean().optional(),
});

/** PRD API contract: POST /v2/corrections/{id}/approve (Approver/Admin). */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = BodySchema.parse(await request.json().catch(() => ({})));
    const correction = await (async () => {
      const { getCorrection } = await import("@/lib/db");
      const existing = await getCorrection(id);
      if (!existing) return null;
      const ctx = await requireContext(request, existing.workspace_id);
      requireApprover(ctx);
      return approveCorrection(id, ctx.userId, { supersedeExisting: body.supersede_existing });
    })();
    if (!correction) return json({ error: "Correction not found" }, 404);
    return json({ correction });
  } catch (err) {
    return apiError(err);
  }
}
