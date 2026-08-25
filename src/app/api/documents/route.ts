import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { uploadsDir } from "@/lib/config";
import {
  countDocuments,
  defaultWorkspaceId,
  findDocumentByHash,
  getDb,
  getDocument,
  insertDocument,
  listDocuments,
} from "@/lib/db";
import { enqueueIngestion } from "@/lib/ingest";
import { audit } from "@/lib/audit";
import { AuthzError, requireContext, resolveUserId } from "@/lib/rbac";
import { isSupportedUpload } from "@/lib/formats";
import { tierCaps } from "@/lib/config";

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

function workspaceFromRequest(request: Request): string {
  const url = new URL(request.url);
  return url.searchParams.get("workspace_id") ?? request.headers.get("x-crisp-workspace-id") ?? defaultWorkspaceId();
}

export async function GET(request: Request) {
  sweepStale();
  const wsId = workspaceFromRequest(request);
  try {
    // Viewers can list documents (FR-34); non-members cannot see anything.
    await requireContext(request, wsId);
  } catch (err) {
    if (err instanceof AuthzError && err.status === 403) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }
  const docs = listDocuments(wsId);
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
    const wsId = String(form.get("workspace_id") ?? workspaceFromRequest(request));

    const ctx = await import("@/lib/rbac").then((m) => m.requireContext(request, wsId));
    await import("@/lib/rbac").then((m) => m.requireContributor(ctx)); // FR-34: Viewer cannot upload

    // PRD packaging: Free tier caps documents at 1-3.
    const cap = tierCaps[ctx.workspace.plan_tier].documents;
    if (Number.isFinite(cap) && countDocuments(wsId) >= cap && !force) {
      return NextResponse.json(
        { error: `Document cap reached for ${ctx.workspace.plan_tier} plan (${cap}). Upgrade to continue.`, code: "tier_cap" },
        { status: 402 }
      );
    }

    if (!isSupportedUpload(file.name)) {
      return NextResponse.json(
        {
          error: "Unsupported format. Upload a PDF, DOCX, XLSX, EML or MSG file.",
          remediation: "Export your file to one of the supported formats and try again.",
        },
        { status: 415 }
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "File exceeds the 200MB limit." }, { status: 413 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Password-protected / corrupt PDFs fail fast at extraction; detect encryption hint cheaply:
    if (file.name.toLowerCase().endsWith(".pdf")) {
      const header = buffer.subarray(0, 1024).toString("latin1");
      if (!header.startsWith("%PDF")) {
        return NextResponse.json(
          { error: "This does not look like a valid PDF file.", remediation: "Verify the file opens in a PDF reader." },
          { status: 422 }
        );
      }
    }

    const hash = createHash("sha256").update(buffer).digest("hex");
    const duplicate = findDocumentByHash(hash, wsId);
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
    const ext = path.extname(file.name).toLowerCase() || ".bin";
    const storagePath = path.join(uploadsDir(), `${id}${ext}`);
    await writeFile(storagePath, buffer);

    insertDocument({
      id,
      workspace_id: wsId,
      owner_id: resolveUserId(request),
      filename: file.name,
      storage_path: storagePath,
      page_count: 0,
      status: "processing",
      file_hash: hash,
      ocr_warning: false,
      error: null,
    });

    enqueueIngestion(id);
    audit.write(wsId, ctx.userId, "document.uploaded", "document", id, null, { filename: file.name });

    const { storage_path: _sp, ...safe } = getDocument(id)!;
    return NextResponse.json(safe, { status: 202 });
  } catch (err) {
    if (err instanceof AuthzError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[documents.POST]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed", remediation: "Check the file and try again." },
      { status: 500 }
    );
  }
}
