import { readFile, unlink } from "node:fs/promises";
import { config } from "./config";
import { chunkPages } from "./chunker";
import { extractPdfPages } from "./pdf-extract";
import { ocrPdfPage } from "./ocr";
import { embed } from "./embeddings";
import { upsertChunkVectors } from "./vector";
import { getDocument, updateDocumentStatus } from "./db";

const queue: string[] = [];
let pumping = false;

declare global {
  // eslint-disable-next-line no-var
  var __crispIngestBusy: boolean | undefined;
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

export async function ingest(documentId: string): Promise<void> {
  const doc = getDocument(documentId);
  if (!doc) throw new Error("Document not found");
  updateDocumentStatus(documentId, { status: "processing", error: null });

  const buffer = await readFile(doc.storage_path);

  let { pages, pageCount } = await extractPdfPages(buffer);
  pageCount = pageCount || pages.length;

  // OCR fallback for image-only / low-text pages
  let ocrUsed = false;
  if (config.enableOcr) {
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
      lowConfidence > 0
        ? "No extractable text found — the PDF appears to be scanned or handwritten and OCR could not recover it."
        : "The PDF contains no extractable text content."
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
      lowConfidence > 0
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
