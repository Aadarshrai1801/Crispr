import { computeWorkspaceAnalytics } from "@/lib/analytics";
import { requireApprover, requireContext } from "@/lib/rbac";
import { apiError, json } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ workspaceId: string }> };

/** PRD API contract: GET /v2/analytics/{workspace_id} (FR-52, Approver/Admin). */
export async function GET(request: Request, { params }: Params) {
  try {
    const { workspaceId } = await params;
    const ctx = requireContext(request, workspaceId);
    requireApprover(ctx);
    const analytics = await computeWorkspaceAnalytics(workspaceId);
    return json(analytics);
  } catch (err) {
    return apiError(err);
  }
}
