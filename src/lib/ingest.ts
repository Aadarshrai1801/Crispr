import { readFile, unlink } from "node:fs/promises";
import { config } from "./config";
import { chunkPages } from "./chunker";
import { extractAnyDocument } from "./formats";
import { ocrPdfPage } from "./ocr";
import { embed } from "./embeddings";
import { upsertChunkVectors } from "./vector";
import {
  claimNextIngestJob,
  completeIngestJob,
  enqueueIngestJob,
  failIngestJob,
  getDocument,
  updateDocumentStatus,
} from "./db";
import { logger } from "./logger";

declare global {
  var __crispConflictScanTimers: Map<string, ReturnType<typeof setTimeout>> | undefined;
}

const MAX_JOB_ATTEMPTS = 3;

let pumping = false;
let recovered = false;

/**
 * N12: the ingestion queue is a SQLite table, not an in-memory array — jobs
 * survive process restarts. On the first pump after boot, jobs left in
 * `processing` by a crashed process are re-claimed automatically.
 */
export function enqueueIngestion(documentId: string) {
  enqueueIngestJob(documentId);
  void pump();
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    if (!recovered) recovered = true; // interrupted 'processing' rows are re-claimable by design
    for (;;) {
      const job = claimNextIngestJob();
      if (!job) break;
      try {
        await ingest(job.document_id);
        completeIngestJob(job.id);
        scheduleConflictScan(getDocument(job.document_id)?.workspace_id);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown ingestion failure";
        const willRetry = job.attempts < MAX_JOB_ATTEMPTS && !(err instanceof PermanentIngestError);
        logger.error(
          { document_id: job.document_id, attempt: job.attempts, will_retry: willRetry, err },
          "ingestion failed"
        );
        failIngestJob(job.id, message, willRetry);
        updateDocumentStatus(job.document_id, {
          status: willRetry ? "processing" : "failed",
          error: willRetry ? `${message} (retrying)` : message,
        });
      }
    }
  } finally {
    pumping = false;
  }
}

/** Errors that retrying can never fix (e.g. unsupported/corrupt file). */
export class PermanentIngestError extends Error {}

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
          const result = await scanWorkspaceConflicts(workspaceId);
          if (result.alerts_created > 0) logger.info({ workspace_id: workspaceId, alerts_created: result.alerts_created }, "conflict scan created alerts");
        } catch (err) {
          logger.warn({ err, workspace_id: workspaceId }, "conflict scan failed");
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

  const extracted = await extractAnyDocument(buffer, doc.filename);
  const { pages, format } = extracted;
  const pageCount: number = extracted.pageCount || pages.length;

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
    // Retrying a file with no extractable text can never succeed.
    throw new PermanentIngestError(
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
