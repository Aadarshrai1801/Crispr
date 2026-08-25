import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { uploadsDir } from "@/lib/config";
import { defaultUserId, defaultWorkspaceId, findDocumentByHash, insertDocument, listDocuments, getDb } from "@/lib/db";
import { enqueueIngestion } from "@/lib/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 200 * 1024 * 1024;

/** Mark documents stuck in `processing` as failed (interrupted by restart). */
function sweepStale() {
  getDb()
    .prepare(
      `UPDATE documents SET status = 'failed', error = 'Ingestion was interrupted (server restarted). Re-upload to retry.'
       WHERE status = 'processing' AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-15 minutes')`
    )
    .run();
}

export async function GET() {
  sweepStale();
  const docs = listDocuments(defaultWorkspaceId());
  // Never expose absolute server paths
  return NextResponse.json(docs.map(({ storage_path: _sp, ...rest }) => rest));
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file field" }, { status: 400 });
    }
    const force = String(form.get("force") ?? "") === "true";

    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      return NextResponse.json(
        { error: "Unsupported format. Upload a PDF file.", remediation: "Export your file as PDF and try again." },
        { status: 415 }
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "File exceeds the 200MB limit." }, { status: 413 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Password-protected / corrupt files fail fast at extraction; but detect encryption hint cheaply:
    const header = buffer.subarray(0, 1024).toString("latin1");
    if (!header.startsWith("%PDF")) {
      return NextResponse.json(
        { error: "This does not look like a valid PDF file.", remediation: "Verify the file opens in a PDF reader." },
        { status: 422 }
      );
    }

    const hash = createHash("sha256").update(buffer).digest("hex");
    const duplicate = findDocumentByHash(hash);
    if (duplicate && !force) {
      return NextResponse.json(
        {
          error: "duplicate",
          message: `An identical copy of this file already exists as "${duplicate.filename}".`,
          existing_document: { id: duplicate.id, filename: duplicate.filename, status: duplicate.status },
        },
        { status: 409 }
      );
    }

    const id = "doc_" + randomUUID();
    mkdirSync(uploadsDir(), { recursive: true });
    const storagePath = path.join(uploadsDir(), `${id}.pdf`);
    await writeFile(storagePath, buffer);

    insertDocument({
      id,
      workspace_id: defaultWorkspaceId(),
      owner_id: defaultUserId(),
      filename: file.name,
      storage_path: storagePath,
      page_count: 0,
      status: "processing",
      file_hash: hash,
      ocr_warning: false,
      error: null,
    });

    enqueueIngestion(id);
    const { storage_path: _sp, ...safe } = insertDocumentSafe(id);
    return NextResponse.json(safe, { status: 202 });
  } catch (err) {
    console.error("[documents.POST]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed", remediation: "Check the file and try again." },
      { status: 500 }
    );
  }
}

import { getDocument } from "@/lib/db";
function insertDocumentSafe(id: string) {
  return getDocument(id)!;
}
