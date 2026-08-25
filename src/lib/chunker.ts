import { config } from "./config";

export interface PageText {
  pageNumber: number;
  text: string;
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  pageNumber: number;
  sectionLabel: string | null;
  text: string;
  tokenCount: number;
}

/** Heuristic heading detector for section labels (best-effort, nullable per PRD). */
function looksLikeHeading(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 90) return false;
  if (/[.,;]$/.test(trimmed)) return false;
  if (/^\d+(\.\d+)*[.)]?\s+\S/.test(trimmed)) return true; // "1.2 Scope" style
  const words = trimmed.split(/\s+/);
  if (words.length <= 10 && words.every((w) => w === w.toUpperCase() && /[A-Z]/.test(w))) return true; // ALL CAPS
  if (
    words.length <= 9 &&
    /^[A-Z]/.test(trimmed) &&
    words.filter((w) => /^[A-Z]/.test(w)).length >= Math.ceil(words.length * 0.6)
  )
    return true; // Title Case-ish
  return false;
}

function clean(text: string): string {
  return text.replace(/\r/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export function chunkPages(pages: PageText[], documentId: string): DocumentChunk[] {
  const { chunkSize, chunkOverlap } = config;
  const chunks: DocumentChunk[] = [];
  let index = 0;

  for (const page of pages) {
    const text = clean(page.text);
    if (!text) continue;

    // Track current section as we walk paragraphs.
    let section: string | null = null;
    const blocks = text.split(/\n\s*\n|\n/).map((b) => b.trim()).filter(Boolean);

    const pieces: { text: string; section: string | null }[] = [];
    let currentPiece = "";
    for (const block of blocks) {
      if (looksLikeHeading(block) && block.length < 80) section = block.replace(/^\d+(\.\d+)*[.)]?\s*/, "").slice(0, 120);
      const candidate = currentPiece ? currentPiece + "\n" + block : block;
      if (candidate.length > chunkSize) {
        if (currentPiece) pieces.push({ text: currentPiece, section });
        currentPiece = block;
        while (currentPiece.length > chunkSize) {
          pieces.push({ text: currentPiece.slice(0, chunkSize), section });
          currentPiece = currentPiece.slice(chunkSize - chunkOverlap);
        }
      } else {
        currentPiece = candidate;
      }
    }
    if (currentPiece.trim()) pieces.push({ text: currentPiece, section });

    for (const piece of pieces) {
      if (piece.text.trim().length < 24) continue; // skip noise fragments
      chunks.push({
        id: `${documentId}_c${index++}`,
        documentId,
        pageNumber: page.pageNumber,
        sectionLabel: piece.section,
        text: piece.text,
        tokenCount: Math.ceil(piece.text.length / 4),
      });
    }
  }
  return chunks;
}
