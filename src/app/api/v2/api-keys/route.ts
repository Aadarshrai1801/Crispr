import { randomBytes } from "node:crypto";
import { z } from "zod";
import { insertApiKey, listApiKeys } from "@/lib/db";
import { sha256Hex } from "@/lib/crypto-utils";
import { audit } from "@/lib/audit";
import { requireAdmin, requireContext, requireTier } from "@/lib/rbac";
import { apiError, json } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.enum(["query", "write"])).min(1).default(["query"]),
});

/** FR-46: API keys scoped per-workspace. Enterprise tier only (pricing table). */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspace_id") ?? "ws_default";
    const ctx = await requireContext(request, workspaceId);
    requireTier(ctx.workspace, "apiKeys");
    requireAdmin(ctx);
    return json({ keys: await listApiKeys(workspaceId) });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const body = CreateSchema.parse(await request.json());
    const workspaceId = new URL(request.url).searchParams.get("workspace_id") ?? "ws_default";
    const ctx = await requireContext(request, workspaceId);
    requireTier(ctx.workspace, "apiKeys");
    requireAdmin(ctx);

    // Only the prefix is stored in plaintext; the full secret is hashed (sha-256).
    const secret = "cris_" + randomBytes(24).toString("base64url");
    const key = await insertApiKey({
      workspace_id: workspaceId,
      key_hash: sha256Hex(secret),
      key_prefix: secret.slice(0, 12),
      scopes: body.scopes,
      created_by: ctx.userId,
      name: body.name,
    });

    await audit.write(workspaceId, ctx.userId, "apikey.created", "api_key", key.id, null, { name: body.name, scopes: body.scopes });
    return json({ key, secret }, 201);
  } catch (err) {
    return apiError(err);
  }
}
