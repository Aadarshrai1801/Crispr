/**
 * Best-effort OCR fallback for scanned / image-only pages.
 * Renders the page via pdfjs onto an @napi-rs/canvas surface, then runs tesseract.js.
 * Any failure degrades gracefully: callers flag the page as low-confidence extraction
 * instead of failing the document (per PRD edge-case policy).
 */

import { logger } from "./logger";

export async function ocrPdfPage(
  buffer: Buffer,
  pageNumber: number,
  minChars: number
): Promise<{ text: string; ok: boolean }> {
  try {
    const [{ createCanvas }, pdfjs, tesseract] = await Promise.all([
      import("@napi-rs/canvas"),
      import("pdfjs-dist/legacy/build/pdf.mjs" as string),
      import("tesseract.js"),
    ]);

    const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
    const page = await doc.getPage(Math.min(Math.max(pageNumber, 1), doc.numPages));
    const viewport = page.getViewport({ scale: 2 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport }).promise;
    const png = await canvas.encode("png");
    void minChars;

    const worker = await tesseract.createWorker("eng");
    try {
      const result = await worker.recognize(png);
      return { text: result.data.text ?? "", ok: true };
    } finally {
      await worker.terminate();
    }
  } catch (err) {
    logger.warn({ page_number: pageNumber, err }, "OCR unavailable for page");
    return { text: "", ok: false };
  }
}
