import { z } from "zod";
import {
  deleteIntegrationConnection,
  getIntegrationConnection,
  listIntegrationConnections,
  upsertIntegrationConnection,
} from "@/lib/db";
import { encryptJson } from "@/lib/crypto-utils";
import { audit } from "@/lib/audit";
import { requireAdmin, requireContext, requireTier } from "@/lib/rbac";
import { apiError, json } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const ConnectSchema = z.object({
  provider: z.enum(["slack", "teams", "gdrive", "notion", "confluence", "sharepoint", "zapier"]),
  display_name: z.string().max(120).optional(),
  /** Provider-specific credential payload; encrypted at rest (AES-256-GCM). */
  credentials: z.record(z.unknown()).optional(),
});

const ENTERPRISE_ONLY = new Set(["confluence", "sharepoint"]);

/** FR-48/FR-45: integration connection registry. Confluence/SharePoint are Enterprise-gated (FR-48). */
export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    await requireContext(request, id);
    return json({ connections: await listIntegrationConnections(id) });
  } catch (err) {
    return apiError(err);
  }
}

/** PRD API contract: POST /v2/integrations/connect — register a connection (Admin role required). */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = ConnectSchema.parse(await request.json());
    const ctx = await requireContext(request, id);
    requireAdmin(ctx);

    if (ENTERPRISE_ONLY.has(body.provider)) {
      requireTier(ctx.workspace, "confluenceSharepoint");
    }

    // Local deployment note: full OAuth handshakes for Slack/Teams/Drive/Notion
    // happen against the provider's consent screen using env-configured app
    // credentials; this endpoint records the resulting connection + tokens.
    // A connect without credentials is a simulated handshake (local demo), so
    // the connection lands in "connected" either way.
    const connection = await upsertIntegrationConnection({
      workspace_id: id,
      provider: body.provider,
      display_name: body.display_name ?? "",
      auth_credentials_encrypted: body.credentials ? encryptJson(body.credentials) : null,
      sync_status: "connected",
    });

    await audit.write(id, ctx.userId, "integration.connected", "integration", body.provider, null, {
      provider: body.provider,
      status: connection.sync_status,
    });
    return json({ connection }, 201);
  } catch (err) {
    return apiError(err);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const provider = url.searchParams.get("provider") ?? "";
    const ctx = await requireContext(request, id);
    requireAdmin(ctx);
    if (!(await getIntegrationConnection(id, provider))) return json({ error: "Connection not found" }, 404);

    await deleteIntegrationConnection(id, provider);
    await audit.write(id, ctx.userId, "integration.disconnected", "integration", provider, { provider }, null);
    return json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
