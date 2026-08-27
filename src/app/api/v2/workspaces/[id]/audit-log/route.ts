import { audit } from "@/lib/audit";
import { requireAdmin, requireContext } from "@/lib/rbac";
import { apiError } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * PRD API contract: GET /v2/workspaces/{id}/audit-log?format=csv|json
 * FR-41 — immutable append-only log, Admin-only export.
 */
export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = await requireContext(request, id);
    requireAdmin(ctx);

    const url = new URL(request.url);
    const format = (url.searchParams.get("format") ?? "json").toLowerCase();
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 1000) || 1000, 5000);

    const entries = await audit.list(id, limit);

    if (format === "csv") {
      const csv = audit.toCsv(entries);
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="audit-${id}.csv"`,
        },
      });
    }
    return Response.json({ entries, count: entries.length });
  } catch (err) {
    return apiError(err);
  }
}
