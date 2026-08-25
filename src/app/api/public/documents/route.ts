import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { uploadsDir } from "@/lib/config";
import { findDocumentByHash, getDocument, insertDocument } from "@/lib/db";
import { enqueueIngestion } from "@/lib/ingest";
import { isSupportedUpload } from "@/lib/formats";
import { ApiKeyError, authenticateApiKey, requireScope } from "@/lib/api-key-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 200 * 1024 * 1024;

/** FR-46 public API: multipart document upload under the API key's workspace. */
export async function POST(request: Request) {
  try {
    const ctx = authenticateApiKey(request);
    requireScope(ctx, "write");

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Missing file field" }, { status: 400 });
    if (!isSupportedUpload(file.name)) {
      return NextResponse.json({ error: "Unsupported format. Supported: PDF, DOCX, XLSX, EML, MSG." }, { status: 415 });
    }
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "File exceeds the 200MB limit." }, { status: 413 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const hash = createHash("sha256").update(buffer).digest("hex");
    const existing = findDocumentByHash(hash, ctx.workspace_id);
    if (existing) {
      const { storage_path: _sp, ...safeExisting } = getDocument(existing.id)!;
      return NextResponse.json({ ...safeExisting, already_ingested: true }, { status: 409 });
    }

    const id = "doc_" + randomUUID();
    mkdirSync(uploadsDir(), { recursive: true });
    const ext = path.extname(file.name).toLowerCase() || ".bin";
    const storagePath = path.join(uploadsDir(), `${id}${ext}`);
    await writeFile(storagePath, buffer);

    insertDocument({
      id,
      workspace_id: ctx.workspace_id,
      owner_id: `apikey:${ctx.key.id}`,
      filename: file.name,
      storage_path: storagePath,
      page_count: 0,
      status: "processing",
      file_hash: hash,
      ocr_warning: false,
      error: null,
    });
    enqueueIngestion(id);

    const { storage_path: _sp, ...safe } = getDocument(id)!;
    return NextResponse.json(safe, { status: 202 });
  } catch (err) {
    if (err instanceof ApiKeyError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[public.documents]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Upload failed" }, { status: 500 });
  }
}
