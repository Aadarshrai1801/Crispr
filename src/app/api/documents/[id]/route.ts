import { NextResponse } from "next/server";
import { deleteCorrectionsForDocument, getDb, getDocument } from "@/lib/db";
import { deleteVectorsForDocument, removeCorrectionVector } from "@/lib/vector";
import { deleteDocumentFile } from "@/lib/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const doc = getDocument(id);
  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  const { storage_path: _sp, ...safe } = doc;
  return NextResponse.json(safe);
}

/**
 * DELETE cascades per PRD: chunks/embeddings always removed; document-scoped
 * corrections removed; workspace-scoped corrections persist by stated retention policy.
 */
export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const doc = getDocument(id);
  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  await deleteVectorsForDocument(id);

  const scoped = getDb().prepare("SELECT id FROM corrections WHERE document_id = ?").all(id) as { id: string }[];
  for (const c of scoped) {
    await removeCorrectionVector(c.id).catch(() => undefined);
  }
  deleteCorrectionsForDocument(id);
  deleteDocumentFile(doc.storage_path);

  getDb().prepare("DELETE FROM documents WHERE id = ?").run(id);

  return NextResponse.json({ ok: true });
}
