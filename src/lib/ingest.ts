import { readFile, unlink } from "node:fs/promises";
import { config } from "./config";
import { chunkPages } from "./chunker";
import { extractAnyDocument } from "./formats";
import { ocrPdfPage } from "./ocr";
import { embed } from "./embeddings";
import { upsertChunkVectors } from "./vector";
import { getDocument, updateDocumentStatus } from "./db";

const queue: string[] = [];
let pumping = false;

declare global {
  // eslint-disable-next-line no-var
  var __crispIngestBusy: boolean | undefined;
  // eslint-disable-next-line no-var
  var __crispConflictScanTimers: Map<string, ReturnType<typeof setTimeout>> | undefined;
}

export function enqueueIngestion(documentId: string) {
  if (!queue.includes(documentId)) queue.push(documentId);
  void pump();
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length) {
      const id = queue.shift()!;
      try {
        await ingest(id);
        scheduleConflictScan(getDocument(id)?.workspace_id);
      } catch (err) {
        console.error(`[ingest] ${id} failed:`, err);
        updateDocumentStatus(id, {
          status: "failed",
          error: err instanceof Error ? err.message : "Unknown ingestion failure",
        });
      }
    }
  } finally {
    pumping = false;
  }
}

/**
 * FR-43: proactive conflict detection runs after new content lands in a
 * workspace — debounced so batch uploads trigger one scan, not N.
 */
export function scheduleConflictScan(workspaceId?: string, delayMs = 30_000) {
  if (!workspaceId) return;
  globalThis.__crispConflictScanTimers ??= new Map();
  const timers = globalThis.__crispConflictScanTimers;
  const existing = timers.get(workspaceId);
  if (existing) clearTimeout(existing);
  timers.set(
    workspaceId,
    setTimeout(() => {
      timers.delete(workspaceId);
      void (async () => {
        try {
          const { scanWorkspaceConflicts } = await import("./conflicts");
          const created = await scanWorkspaceConflicts(workspaceId);
          if (created > 0) console.log(`[conflicts] ${workspaceId}: ${created} new alert(s)`);
        } catch (err) {
          console.warn("[conflicts] scan failed:", err instanceof Error ? err.message : err);
        }
      })();
    }, delayMs)
  );
}

export async function ingest(documentId: string): Promise<void> {
  const doc = getDocument(documentId);
  if (!doc) throw new Error("Document not found");
  updateDocumentStatus(documentId, { status: "processing", error: null });

  const buffer = await readFile(doc.storage_path);

  let { pages, pageCount, format } = await extractAnyDocument(buffer, doc.filename);
  pageCount = pageCount || pages.length;

  // OCR fallback for image-only / low-text PDF pages
  let ocrUsed = false;
  if (config.enableOcr && format === "pdf") {
    for (const page of pages) {
      if (page.text.trim().length >= config.ocrMinChars) continue;
      const result = await ocrPdfPage(buffer, page.pageNumber, config.ocrMinChars);
      if (result.ok && result.text.trim().length > 0) {
        page.text = result.text;
        ocrUsed = true;
      }
    }
  }
  const lowConfidence = pages.filter((p) => p.text.trim().length < config.ocrMinChars).length;

  const chunks = chunkPages(pages, documentId);
  if (!chunks.length) {
    throw new Error(
      lowConfidence > 0 && format === "pdf"
        ? "No extractable text found — the file appears to be scanned or handwritten and OCR could not recover it."
        : "The file contains no extractable text content."
    );
  }

  const vectors = await embed(chunks.map((c) => c.text));
  await upsertChunkVectors(
    chunks.map((c, i) => ({
      id: c.id,
      document_id: c.documentId,
      workspace_id: doc.workspace_id,
      page_number: c.pageNumber,
      section_label: c.sectionLabel ?? "",
      text: c.text,
      vector: vectors[i],
    }))
  );

  updateDocumentStatus(documentId, {
    status: "ready",
    page_count: pageCount,
    ocr_warning: ocrUsed || lowConfidence > 0,
    error:
      lowConfidence > 0 && format === "pdf"
        ? `${lowConfidence} page(s) had little/no machine-readable text${ocrUsed ? "; OCR was applied where possible" : " and OCR was unavailable"} — answers from those pages may be incomplete.`
        : null,
  });
}

export async function deleteDocumentFile(storagePath: string) {
  try {
    await unlink(storagePath);
  } catch {
    /* file may already be gone */
  }
}
