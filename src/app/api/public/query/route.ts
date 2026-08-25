import { NextResponse } from "next/server";
import { z } from "zod";
import { answerQuestion, readyDocumentIds, resolveQueryScope } from "@/lib/retrieval";
import { getDocument, listDocuments } from "@/lib/db";
import { ApiKeyError, authenticateApiKey, requireScope } from "@/lib/api-key-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BodySchema = z.object({
  question: z.string().min(3).max(2000),
  document_ids: z.array(z.string()).optional(),
  /** Query across all documents in the key's workspace. */
  workspace_wide: z.boolean().optional(),
});

/**
 * FR-46 public API: POST query — embed Crispr's Q&A engine in third-party
 * products. Requires an Enterprise-tier API key with the `query` scope.
 * Responses include confidence flags; low-confidence answers carry
 * `flagged_needs_review: true` and must not be treated as authoritative.
 */
export async function POST(request: Request) {
  try {
    const ctx = authenticateApiKey(request);
    requireScope(ctx, "query");

    const body = BodySchema.parse(await request.json());
    const wsId = ctx.workspace_id;

    let requested = body.workspace_wide ? readyDocumentIds(wsId) : (body.document_ids ?? []);
    if (!requested.length && !body.workspace_wide) requested = readyDocumentIds(wsId);

    const owned = new Set(listDocuments(wsId).map((d) => d.id));
    requested = requested.filter((id) => owned.has(id));

    const readyDocs = requested.filter((id) => getDocument(id)?.status === "ready");
    if (!readyDocs.length) {
      return NextResponse.json({ error: "No ready documents available in this workspace." }, { status: 409 });
    }

    const scope = resolveQueryScope(readyDocs, wsId);
    const result = await answerQuestion({
      workspaceId: wsId,
      userId: `apikey:${ctx.key.id}`,
      documentIds: scope.documentIds,
      question: body.question,
    });

    return NextResponse.json({
      ...result,
      narrowed_search: scope.narrowed,
      // Downstream integrations must respect this flag (FR-42).
      authoritative: !result.confidence.flagged_needs_review,
    });
  } catch (err) {
    if (err instanceof ApiKeyError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof z.ZodError) return NextResponse.json({ error: "Invalid request", details: err.issues }, { status: 400 });
    console.error("[public.query]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Query failed" }, { status: 500 });
  }
}
