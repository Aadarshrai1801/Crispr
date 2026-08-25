import { listConflictAlerts } from "@/lib/db";
import { scanWorkspaceConflicts } from "@/lib/conflicts";
import { requireApprover, requireContext } from "@/lib/rbac";
import { apiError, json } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

/** PRD API contract: GET /v2/workspaces/{id}/conflicts — open conflict alerts (FR-43). */
export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const status = url.searchParams.get("status") as "open" | "resolved" | "dismissed" | null;
    const ctx = requireContext(request, id);
    requireApprover(ctx);
    return json({ conflicts: listConflictAlerts(id, status ?? undefined) });
  } catch (err) {
    return apiError(err);
  }
}

/** Trigger an on-demand conflict scan (also runs automatically after ingestions). */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = requireContext(request, id);
    requireApprover(ctx);
    const result = await scanWorkspaceConflicts(id, ctx.userId);
    return json({ result });
  } catch (err) {
    return apiError(err);
  }
}
