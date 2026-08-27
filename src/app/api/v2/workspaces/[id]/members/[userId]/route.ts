import { z } from "zod";
import { getUser, removeMember, upsertMember } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireAdmin, requireContext } from "@/lib/rbac";
import { apiError, json } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; userId: string }> };

const PatchSchema = z.object({
  role: z.enum(["Admin", "Approver", "Contributor", "Viewer"]),
});

/** Change a member's role (Admin only). */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id, userId } = await params;
    const body = PatchSchema.parse(await request.json());
    const ctx = await requireContext(request, id);
    requireAdmin(ctx);
    if (!(await getUser(userId))) return json({ error: "User not found" }, 404);

    const member = await upsertMember({ workspace_id: id, user_id: userId, role: body.role });
    await audit.write(id, ctx.userId, "member.role_changed", "user", userId, null, { role: body.role });
    return json({ member });
  } catch (err) {
    return apiError(err);
  }
}

/** Remove a member (Admin only). The workspace owner cannot be removed. */
export async function DELETE(request: Request, { params }: Params) {
  try {
    const { id, userId } = await params;
    const ctx = await requireContext(request, id);
    requireAdmin(ctx);
    if (userId === ctx.workspace.owner_id) {
      return json({ error: "The workspace owner cannot be removed." }, 409);
    }
    await removeMember(id, userId);
    await audit.write(id, ctx.userId, "member.removed", "user", userId, null, null);
    return json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
