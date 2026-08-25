import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { getDocument } from "@/lib/db";
import { requireContext } from "@/lib/rbac";
import { apiError } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Serves the stored PDF to the inline viewer. Requires an authenticated
 * session AND workspace membership for the document (N16) — previously any
 * visitor with a document id could download the file.
 */
export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const doc = getDocument(id);
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    await requireContext(request, doc.workspace_id);
    const buffer = await readFile(doc.storage_path);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${encodeURIComponent(doc.filename)}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    return apiError(err);
  }
}
