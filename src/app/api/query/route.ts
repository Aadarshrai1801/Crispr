import { NextResponse } from "next/server";
import { z } from "zod";
import { answerQuestion, readyDocumentIds, resolveQueryScope } from "@/lib/retrieval";
import { defaultUserId, defaultWorkspaceId, getDocument, listDocuments } from "@/lib/db";
import { LlmNotConfiguredError } from "@/lib/llm";
import { requireContext } from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BodySchema = z
  .object({
    document_ids: z.array(z.string()).min(1).optional(),
    workspace_wide: z.boolean().optional(), // FR-37: query all documents in the workspace
    question: z.string().min(3).max(2000),
  })
  .refine((b) => b.document_ids?.length || b.workspace_wide, { message: "Provide document_ids or workspace_wide" });

export async function POST(request: Request) {
  try {
    const body = BodySchema.parse(await request.json());
    const wsId =
      request.headers.get("x-crisp-workspace-id") ?? new URL(request.url).searchParams.get("workspace_id") ?? defaultWorkspaceId();

    // FR-34: any member (including Viewer) can query documents.
    await requireContext(request, wsId);

    let requested = body.workspace_wide ? readyDocumentIds(wsId) : (body.document_ids ?? []);
    if (!body.workspace_wide) {
      // Scope guard: only allow querying documents that belong to this workspace.
      const owned = new Set(listDocuments(wsId).map((d) => d.id));
      requested = requested.filter((id) => owned.has(id));
    }

    const readyDocs = requested.filter((id) => getDocument(id)?.status === "ready");
    if (!readyDocs.length) {
      return NextResponse.json(
        { error: "None of the selected documents are ready yet. Wait for processing to finish." },
        { status: 409 }
      );
    }

    // PRD non-functional requirement: degrade gracefully beyond 50 docs.
    const scope = resolveQueryScope(readyDocs, wsId);

    const payload = await answerQuestion({
      workspaceId: wsId,
      userId: request.headers.get("x-crisp-user-id") ?? defaultUserId(),
      documentIds: scope.documentIds,
      question: body.question,
    });
    return NextResponse.json({ ...payload, narrowed_search: scope.narrowed });
  } catch (err) {
    if (err instanceof LlmNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request", details: err.issues }, { status: 400 });
    }
    console.error("[query.POST]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Query failed" },
      { status: 500 }
    );
  }
}
