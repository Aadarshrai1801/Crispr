import { listPendingCorrections } from "@/lib/db";
import { requireContext, requireApprover } from "@/lib/rbac";
import { apiError, json } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * FR-36: pending-approvals queue — all corrections awaiting review.
 * Approver/Admin only (Viewer/Contributor can see statuses elsewhere but not operate the queue).
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspace_id") ?? "ws_default";
    const ctx = requireContext(request, workspaceId);
    requireApprover(ctx);
    return json({ corrections: listPendingCorrections(workspaceId) });
  } catch (err) {
    return apiError(err);
  }
}
