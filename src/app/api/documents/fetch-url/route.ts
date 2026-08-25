import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { uploadsDir } from "@/lib/config";
import { defaultWorkspaceId, findDocumentByHash, getDocument, insertDocument } from "@/lib/db";
import { enqueueIngestion } from "@/lib/ingest";
import { audit } from "@/lib/audit";
import { requireContext, requireContributor } from "@/lib/rbac";
import { apiError } from "@/lib/api-helpers";
import { safeFetch } from "@/lib/ssrf";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * FR-49 support: ingest a PDF directly from a URL (used by the browser
 * extension so users can query a PDF open in a tab without leaving it).
 */
const BodySchema = z.object({
  url: z.string().url(),
  workspace_id: z.string().optional(),
  filename: z.string().max(255).optional(),
});

const MAX_BYTES = 200 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const body = BodySchema.parse(await request.json());
    const wsId = body.workspace_id ?? defaultWorkspaceId();
    const ctx = requireContext(request, wsId);
    requireContributor(ctx);

    // Blocker #4: uploads trigger OCR/embedding compute — throttle per user.
    const limit = checkRateLimit(`write:${ctx.userId}`, "write");
    if (!limit.ok) return rateLimitResponse(limit);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    let response: Response;
    try {
      // Blocker #3: validated per hop — redirects are followed manually and
      // each target is re-checked against private/link-local ranges.
      response = await safeFetch(body.url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      return NextResponse.json({ error: `Failed to download (${response.status}).` }, { status: 422 });
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_BYTES) {
      return NextResponse.json({ error: "Downloaded file exceeds the 200MB limit." }, { status: 413 });
    }
    if (!buffer.subarray(0, 1024).toString("latin1").startsWith("%PDF")) {
      return NextResponse.json({ error: "The URL did not return a PDF file." }, { status: 422 });
    }

    const hash = createHash("sha256").update(buffer).digest("hex");
    const existing = findDocumentByHash(hash, wsId);
    if (existing) {
      const { storage_path: _sp, ...safeExisting } = getDocument(existing.id)!;
      return NextResponse.json({ ...safeExisting, already_ingested: true }, { status: 200 });
    }

    const derivedName =
      body.filename ?? (decodeURIComponent(new URL(body.url).pathname.split("/").pop() || "") || "document.pdf");
    const filename = derivedName.toLowerCase().endsWith(".pdf") ? derivedName : `${derivedName}.pdf`;

    const id = "doc_" + randomUUID();
    mkdirSync(uploadsDir(), { recursive: true });
    const storagePath = path.join(uploadsDir(), `${id}.pdf`);
    await writeFile(storagePath, buffer);

    insertDocument({
      id,
      workspace_id: wsId,
      owner_id: ctx.userId,
      filename,
      storage_path: storagePath,
      page_count: 0,
      status: "processing",
      file_hash: hash,
      ocr_warning: false,
      error: null,
    });
    enqueueIngestion(id);
    audit.write(wsId, ctx.userId, "document.uploaded", "document", id, null, { filename, source_url: body.url });

    const { storage_path: _sp, ...safe } = getDocument(id)!;
    return NextResponse.json(safe, { status: 202 });
  } catch (err) {
    return apiError(err);
  }
}
