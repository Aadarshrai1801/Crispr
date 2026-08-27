import { listCorrectionsWithPendingEdits, listPendingCorrections } from "@/lib/db";
import { requireContext, requireApprover } from "@/lib/rbac";
import { apiError, json } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * FR-36: pending-approvals queue — all corrections awaiting review, plus
 * proposed edits on live corrections awaiting an accept/reject decision.
 * Approver/Admin only (Viewer/Contributor can see statuses elsewhere but not operate the queue).
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspace_id") ?? "ws_default";
    const ctx = await requireContext(request, workspaceId);
    requireApprover(ctx);
    const edits = (await listCorrectionsWithPendingEdits(workspaceId)).map((row) => ({
      ...row,
      pending_edit: row.pending_edit ? (JSON.parse(row.pending_edit) as Record<string, unknown>) : null,
    }));
    return json({ corrections: await listPendingCorrections(workspaceId), edits });
  } catch (err) {
    return apiError(err);
  }
}
