import { NextResponse } from "next/server";
import { deleteCorrectionsForDocument, getDb, getDocument, listCorrections } from "@/lib/db";
import { deleteVectorsForDocument, removeCorrectionVector } from "@/lib/vector";
import { deleteDocumentFile } from "@/lib/ingest";
import { audit } from "@/lib/audit";
import { requireContext, requireContributor, AuthzError } from "@/lib/rbac";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const doc = getDocument(id);
  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  try {
    await requireContext(request, doc.workspace_id);
  } catch (err) {
    if (err instanceof AuthzError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
  const { storage_path: _sp, ...safe } = doc;
  return NextResponse.json(safe);
}

/**
 * DELETE cascades per PRD: chunks/embeddings always removed; document-scoped
 * corrections removed (with their comments); workspace-scoped corrections
 * persist by stated retention policy. Every action is audited.
 */
export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  const doc = getDocument(id);
  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  try {
    const ctx = requireContext(request, doc.workspace_id);
    requireContributor(ctx); // FR-34: Viewer cannot delete

    await deleteVectorsForDocument(id);

    const scoped = listCorrections(doc.workspace_id).filter((c) => c.document_id === id);
    for (const c of scoped) {
      await removeCorrectionVector(c.id).catch(() => undefined);
    }
    if (scoped.length) {
      (await import("@/lib/db")).deleteCommentsForCorrections(scoped.map((c) => c.id));
    }
    deleteCorrectionsForDocument(id);
    deleteDocumentFile(doc.storage_path);

    // Version archives live under uploads/versions/<id>; remove them too.
    const path = await import("node:path");
    const rm = await import("node:fs/promises");
    await rm.rm(path.join(doc.storage_path, "..", "versions", id), { recursive: true, force: true }).catch(() => undefined);

    audit.write(doc.workspace_id, ctx.userId, "document.deleted", "document", id, { filename: doc.filename }, null);
    getDb().prepare("DELETE FROM document_versions WHERE document_id = ?").run(id);
    getDb().prepare("DELETE FROM documents WHERE id = ?").run(id);

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthzError) return NextResponse.json({ error: err.message }, { status: err.status });
    logger.error({ err }, "[documents.DELETE]");
    return NextResponse.json({ error: err instanceof Error ? err.message : "Delete failed" }, { status: 500 });
  }
}
