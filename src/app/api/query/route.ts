import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { z } from "zod";
import { answerQuestion, readyDocumentIds, resolveQueryScope } from "@/lib/retrieval";
import { defaultWorkspaceId, getDocument, listDocuments } from "@/lib/db";
import { LlmNotConfiguredError } from "@/lib/llm";
import { requireContext } from "@/lib/rbac";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

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
      request.headers.get("x-crisp-workspace-id") ?? new URL(request.url).searchParams.get("workspace_id") ?? (await defaultWorkspaceId());

    // FR-34: any member (including Viewer) can query documents. Identity now
    // comes from the session cookie (blocker #1) — headers are untrusted.
    const ctx = await requireContext(request, wsId);

    const limit = checkRateLimit(`query:${ctx.userId}`, "llmQuery");
    if (!limit.ok) return rateLimitResponse(limit);

    let requested = body.workspace_wide ? await readyDocumentIds(wsId) : (body.document_ids ?? []);
    if (!body.workspace_wide) {
      // Scope guard: only allow querying documents that belong to this workspace.
      const owned = new Set((await listDocuments(wsId)).map((d) => d.id));
      requested = requested.filter((id) => owned.has(id));
    }

    const readyDocs: string[] = [];
    for (const id of requested) {
      if ((await getDocument(id))?.status === "ready") readyDocs.push(id);
    }
    if (!readyDocs.length) {
      return NextResponse.json(
        { error: "None of the selected documents are ready yet. Wait for processing to finish." },
        { status: 409 }
      );
    }

    // PRD non-functional requirement: degrade gracefully beyond 50 docs.
    const scope = await resolveQueryScope(readyDocs, wsId);

    const payload = await answerQuestion({
      workspaceId: wsId,
      userId: ctx.userId,
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
    logger.error({ err }, "[query.POST]");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Query failed" },
      { status: 500 }
    );
  }
}
