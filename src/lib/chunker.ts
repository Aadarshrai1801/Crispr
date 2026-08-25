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
  if (/^[|]/.test(trimmed)) return false; // markdown table rows are never headings
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

/* ---------------- FR-38: table detection & atomic preservation ---------------- */

/** A line looks like a table row when it has multiple column-ish gaps or pipe cells. */
function tableRowCells(line: string): string[] | null {
  const t = line.trim();
  if (!t) return null;
  if (/^%.+%$/.test(t)) return null; // rule lines
  if ((t.startsWith("|") && t.endsWith("|")) || /^[\w'"$(]+(?:\s{2,}[\w'"$(.,%:-]+){1,}$/.test(t)) {
    const cells = t
      .split(/\s{2,}|(?<=\S)\s*\|\s*(?=\S)/)
      .map((c) => c.replace(/^\||\|$/g, "").trim())
      .filter(Boolean);
    return cells.length >= 2 ? cells : null;
  }
  return null;
}

/**
 * Splits page text into ordered blocks. Consecutive table-looking rows with
 * consistent column counts become ONE atomic `table` block so cell relationships
 * survive chunking and "what was Q3 revenue in the table on page 12" retrieves
 * actual cells rather than nearby prose.
 */
function splitIntoBlocks(text: string): Array<{ kind: "prose" | "table"; text: string }> {
  const lines = text.split("\n");
  const blocks: Array<{ kind: "prose" | "table"; text: string }> = [];
  let proseBuffer: string[] = [];
  let tableRows: string[][] = [];

  const flushProse = () => {
    if (proseBuffer.length) {
      blocks.push({ kind: "prose", text: proseBuffer.join("\n") });
      proseBuffer = [];
    }
  };
  const flushTable = () => {
    if (tableRows.length >= 2) {
      // Render as pipe-markdown so the structure is explicit to the embedding + LLM.
      const widths = tableRows[0].length;
      const normalized = tableRows.map((r) => {
        const cells = [...r];
        while (cells.length < widths) cells.push("");
        return cells.slice(0, Math.max(widths, ...tableRows.map((x) => x.length)));
      });
      const w = normalized[0].length;
      const md = [
        `| ${normalized[0].join(" | ")} |`,
        `| ${Array(w).fill("---").join(" | ")} |`,
        ...normalized.slice(1).map((r) => `| ${r.join(" | ")} |`),
      ].join("\n");
      blocks.push({ kind: "table", text: `[TABLE]\n${md}\n[/TABLE]` });
    } else if (tableRows.length === 1) {
      proseBuffer.push(tableRows[0].join(" "));
    }
    tableRows = [];
  };

  for (const line of lines) {
    const cells = tableRowCells(line);
    if (cells && cells.length >= 2) {
      // Consistent column count (or header row starting a new table) extends the run.
      if (!tableRows.length || Math.abs(cells.length - tableRows[0].length) <= 1) {
        flushProse();
        tableRows.push(cells);
        continue;
      }
      flushTable();
      tableRows.push(cells);
      continue;
    }
    flushTable();
    proseBuffer.push(line);
  }
  flushTable();
  flushProse();

  return blocks;
}

const MAX_TABLE_CHARS = 4000;

export function chunkPages(pages: PageText[], documentId: string): DocumentChunk[] {
  const { chunkSize, chunkOverlap } = config;
  const chunks: DocumentChunk[] = [];
  let index = 0;

  for (const page of pages) {
    const text = clean(page.text);
    if (!text) continue;

    let section: string | null = null;
    const rawBlocks = splitIntoBlocks(text);

    const pieces: { text: string; section: string | null }[] = [];
    let currentPiece = "";

    const pushPiece = () => {
      if (currentPiece.trim()) pieces.push({ text: currentPiece, section });
      currentPiece = "";
    };

    for (const block of rawBlocks) {
      if (block.kind === "prose") {
        for (const para of block.text.split("\n")) {
          // Track current section as we walk paragraphs.
          const trimmedLine = para.trim();
          if (looksLikeHeading(trimmedLine) && trimmedLine.length < 80) {
            section = trimmedLine.replace(/^\d+(\.\d+)*[.)]?\s*/, "").slice(0, 120);
          }
          const candidate = currentPiece ? currentPiece + "\n" + para : para;
          if (candidate.length > chunkSize) {
            pushPiece();
            let rest = para;
            while (rest.length > chunkSize) {
              pieces.push({ text: rest.slice(0, chunkSize), section });
              rest = rest.slice(chunkSize - chunkOverlap);
            }
            currentPiece = rest;
          } else {
            currentPiece = candidate;
          }
        }
      } else {
        // Tables stay atomic (up to a sane cap) so row/column relationships persist.
        pushPiece();
        const body = block.text.length > MAX_TABLE_CHARS ? block.text.slice(0, MAX_TABLE_CHARS) : block.text;
        pieces.push({ text: body, section });
      }
    }
    pushPiece();

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
