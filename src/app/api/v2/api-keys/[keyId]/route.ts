import { getApiKey, revokeApiKey } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireAdmin, requireContext, requireTier } from "@/lib/rbac";
import { apiError, json } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ keyId: string }> };

/** Revoke an API key (immediate; revocation + rotation supported per PRD security reqs). */
export async function DELETE(request: Request, { params }: Params) {
  try {
    const { keyId } = await params;
    const key = getApiKey(keyId);
    if (!key) return json({ error: "API key not found" }, 404);
    const ctx = requireContext(request, key.workspace_id);
    requireTier(ctx.workspace, "apiKeys");
    requireAdmin(ctx);

    revokeApiKey(keyId);
    audit.write(key.workspace_id, ctx.userId, "apikey.revoked", "api_key", keyId, { revoked_at: null }, { revoked: true });
    return json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
