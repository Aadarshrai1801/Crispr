import { deleteWebhookEndpoint, getWebhookEndpoint } from "@/lib/db";
import { requireAdmin, requireContext } from "@/lib/rbac";
import { apiError, json } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; hookId: string }> };

export async function DELETE(request: Request, { params }: Params) {
  try {
    const { id, hookId } = await params;
    const ctx = requireContext(request, id);
    requireAdmin(ctx);
    const endpoint = getWebhookEndpoint(hookId);
    if (!endpoint || endpoint.workspace_id !== id) return json({ error: "Webhook not found" }, 404);
    deleteWebhookEndpoint(hookId);
    return json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
