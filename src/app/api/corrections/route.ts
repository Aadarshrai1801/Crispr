import { NextResponse } from "next/server";
import { z } from "zod";
import { submitCorrection } from "@/lib/corrections";
import { getQueryLog, listCorrections } from "@/lib/db";
import { defaultWorkspaceId } from "@/lib/db";
import { requireContext, requireContributor } from "@/lib/rbac";
import { apiError } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SubmitSchema = z.object({
  query_log_id: z.string(),
  corrected_answer: z.string().min(2).max(8000),
  note: z.string().max(4000).nullable().optional(),
  scope: z.enum(["document", "workspace"]).optional(),
  topic_tags: z.array(z.string()).max(10).optional(),
  resolve: z.enum(["replace", "annotate", "keep"]).optional(),
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const documentId = url.searchParams.get("document_id") ?? undefined;
    const wsId = url.searchParams.get("workspace_id") ?? request.headers.get("x-crisp-workspace-id") ?? defaultWorkspaceId();
    await requireContext(request, wsId); // FR-34: Viewers can view corrections
    const rows = listCorrections(wsId, documentId || undefined);
    return NextResponse.json(rows.map((r) => ({ ...r, topic_tags: JSON.parse(r.topic_tags || "[]") as string[] })));
  } catch (err) {
    return apiError(err);
  }
}

/**
 * PRD API contract: POST /v2/corrections — enters pending state when the
 * workspace has approval_required (FR-33); otherwise goes live immediately.
 */
export async function POST(request: Request) {
  try {
    const body = SubmitSchema.parse(await request.json());

    // Resolve the workspace from the query log so RBAC checks the right place.
    const log = getQueryLog(body.query_log_id);
    if (!log) return NextResponse.json({ error: "Original query log not found" }, { status: 404 });
    const wsId = log.workspace_id || defaultWorkspaceId();

    const ctx = requireContext(request, wsId);
    requireContributor(ctx); // FR-34: Viewer cannot submit

    // Scope guard: submitter must have access to the document in question.
    if (log.document_ids) {
      const ids = JSON.parse(log.document_ids) as string[];
      const owned = new Set((await import("@/lib/db")).listDocuments(wsId).map((d) => d.id));
      if (ids.length && !ids.some((id) => owned.has(id))) {
        return NextResponse.json({ error: "You do not have access to this document's workspace." }, { status: 403 });
      }
    }

    const result = await submitCorrection({
      query_log_id: body.query_log_id,
      corrected_answer: body.corrected_answer,
      note: body.note ?? null,
      scope: body.scope,
      topic_tags: body.topic_tags,
      resolve: body.resolve,
      actor_id: ctx.userId,
      submitter_role: ctx.role,
    });

    if (result.conflictWith && !body.resolve) {
      // FR-28: surface the conflict; client resolves explicitly (FR-29)
      return NextResponse.json(
        {
          conflict: true,
          message: "An active correction for a near-identical question already exists.",
          existing: result.conflictWith,
        },
        { status: 409 }
      );
    }

    return NextResponse.json(
      {
        conflict: false,
        correction: result.correction,
        requires_approval: result.correction.status === "pending",
      },
      { status: 201 }
    );
  } catch (err) {
    return apiError(err);
  }
}
