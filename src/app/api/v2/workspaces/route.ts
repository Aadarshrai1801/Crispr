import { z } from "zod";
import { insertWorkspace, listWorkspacesForUser } from "@/lib/db";
import { audit } from "@/lib/audit";
import { resolveUserId } from "@/lib/rbac";
import { apiError, json } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  name: z.string().min(2).max(120),
  approval_required: z.boolean().optional(),
  confidence_threshold: z.number().min(0).max(1).optional(),
  plan_tier: z.enum(["free", "pro", "team", "enterprise"]).optional(),
});

/** FR-32: create a Workspace with a shared document library + shared correction layer. */
export async function POST(request: Request) {
  try {
    const body = CreateSchema.parse(await request.json());
    const userId = await resolveUserId(request);
    const ws = await insertWorkspace({
      name: body.name,
      owner_id: userId,
      approval_required: body.approval_required ?? false,
      confidence_threshold: body.confidence_threshold ?? undefined,
      plan_tier: body.plan_tier ?? "team",
    });
    await audit.write(ws.id, userId, "workspace.created", "workspace", ws.id, null, {
      name: ws.name,
      plan_tier: ws.plan_tier,
      approval_required: Boolean(ws.approval_required),
    });
    return json({ workspace: ws }, 201);
  } catch (err) {
    return apiError(err);
  }
}

export async function GET(request: Request) {
  try {
    // Blocker #1 hardening: this endpoint used to accept an arbitrary ?user_id=
    // and enumerate anyone's workspaces. It now only ever lists the session
    // user's own workspaces.
    const workspaces = await listWorkspacesForUser(await resolveUserId(request));
    return json({ workspaces });
  } catch (err) {
    return apiError(err);
  }
}
