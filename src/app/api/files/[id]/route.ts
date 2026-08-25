import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { getDocument } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Serves the stored PDF to the inline viewer. */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const doc = getDocument(id);
  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  try {
    const buffer = await readFile(doc.storage_path);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${encodeURIComponent(doc.filename)}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Stored file is missing" }, { status: 410 });
  }
}
