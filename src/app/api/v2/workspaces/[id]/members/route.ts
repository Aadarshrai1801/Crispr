import { z } from "zod";
import { getUser, upsertMember, listMembers } from "@/lib/db";
import { audit } from "@/lib/audit";
import { memberCount, requireAdmin, requireContext } from "@/lib/rbac";
import { tierCaps } from "@/lib/config";
import { apiError, json } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const AddSchema = z.object({
  user_id: z.string().min(1),
  role: z.enum(["Admin", "Approver", "Contributor", "Viewer"]),
});

/** FR-34: membership management (Admin only). */
export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    await requireContext(request, id);
    return json({ members: await listMembers(id) });
  } catch (err) {
    return apiError(err);
  }
}

/** PRD API contract: POST /v2/workspaces/{id}/members — invite/add a member with a role. */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = AddSchema.parse(await request.json());
    const ctx = await requireContext(request, id);
    requireAdmin(ctx);

    const user = await getUser(body.user_id);
    if (!user) return json({ error: "User not found" }, 404);

    const cap = tierCaps[ctx.workspace.plan_tier].members;
    if ((await memberCount(id)) >= cap) {
      return json(
        { error: `Member cap reached for ${ctx.workspace.plan_tier} tier (${cap}).` },
        402
      );
    }

    const member = await upsertMember({ workspace_id: id, user_id: body.user_id, role: body.role });
    await audit.write(id, ctx.userId, "member.added", "user", body.user_id, null, { role: body.role, email: user.email });
    return json({ member }, 201);
  } catch (err) {
    return apiError(err);
  }
}
