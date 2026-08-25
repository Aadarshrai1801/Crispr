import { listSuggestedCorrections } from "@/lib/db";
import { generateRepeatedFlagSuggestions } from "@/lib/suggestions";
import { requireApprover, requireContext } from "@/lib/rbac";
import { apiError, json } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

/** FR-50/FR-51: list compounding-intelligence suggestions (Approver/Admin). */
export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const status = url.searchParams.get("status") as "pending" | "accepted" | "dismissed" | null;
    const ctx = requireContext(request, id);
    requireApprover(ctx);
    return json({ suggestions: listSuggestedCorrections(id, status ?? undefined) });
  } catch (err) {
    return apiError(err);
  }
}

/** On-demand re-analysis of repeated flag patterns (FR-51). */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = requireContext(request, id);
    requireApprover(ctx);
    const created = await generateRepeatedFlagSuggestions(id);
    return json({ suggestions_created: created });
  } catch (err) {
    return apiError(err);
  }
}
