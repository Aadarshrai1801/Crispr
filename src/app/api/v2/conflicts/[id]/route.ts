import { z } from "zod";
import { setConflictStatus } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireApprover, requireContext } from "@/lib/rbac";
import { apiError, json } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const BodySchema = z.object({
  action: z.enum(["resolve", "dismiss"]),
});

/** Resolve or dismiss a conflict alert (Approver/Admin). */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = BodySchema.parse(await request.json());
    const conflict = await (await import("@/lib/db")).getConflictAlert(id);
    if (!conflict) return json({ error: "Conflict alert not found" }, 404);
    const ctx = await requireContext(request, conflict.workspace_id);
    requireApprover(ctx);

    await setConflictStatus(id, body.action === "resolve" ? "resolved" : "dismissed");
    await audit.write(
      conflict.workspace_id,
      ctx.userId,
      body.action === "resolve" ? "conflict.resolved" : "conflict.dismissed",
      "conflict_alert",
      id,
      { status: conflict.status },
      { status: body.action === "resolve" ? "resolved" : "dismissed" }
    );
    return json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
