import { z } from "zod";
import { updateWorkspaceSettings } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireAdmin, requireContext } from "@/lib/rbac";
import { apiError, json } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const PatchSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  approval_required: z.boolean().optional(), // FR-33
  confidence_threshold: z.number().min(0).max(1).optional(), // FR-42
  plan_tier: z.enum(["free", "pro", "team", "enterprise"]).optional(),
});

export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = requireContext(request, id);
    return json({ workspace: ctx.workspace, role: ctx.role });
  } catch (err) {
    return apiError(err);
  }
}

/** Admin-only settings updates (FR-33 approval mode, FR-42 threshold, tier). */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = PatchSchema.parse(await request.json());
    const ctx = requireContext(request, id);
    requireAdmin(ctx);
    updateWorkspaceSettings(id, body);
    audit.write(id, ctx.userId, "workspace.updated", "workspace", id,
      { name: ctx.workspace.name, approval_required: Boolean(ctx.workspace.approval_required), confidence_threshold: ctx.workspace.confidence_threshold, plan_tier: ctx.workspace.plan_tier },
      { ...ctx.workspace.name !== undefined && { name: body.name }, ...(body.approval_required !== undefined && { approval_required: body.approval_required }), ...(body.confidence_threshold !== undefined && { confidence_threshold: body.confidence_threshold }), ...(body.plan_tier !== undefined && { plan_tier: body.plan_tier }) });
    const { getWorkspace } = await import("@/lib/db");
    return json({ workspace: getWorkspace(id) });
  } catch (err) {
    return apiError(err);
  }
}
