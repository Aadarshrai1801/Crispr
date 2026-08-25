import { extractPdfPages } from "./pdf-extract";
import type { Worksheet, Row, Cell } from "exceljs";

/**
 * FR-40: first-class ingestion for Word (.docx), Excel (.xlsx), scanned/OCR'd
 * contracts (via the existing PDF path), and email exports (.eml/.msg) — same
 * downstream chunk/embed/correction mechanics as PDF.
 *
 * FR-38: structured content from tables is extracted AS tables (pipe-markdown
 * rows), preserving row/column relationships so cell-level questions retrieve
 * the actual cells instead of a paraphrase of surrounding prose.
 */

export interface ExtractedPage {
  pageNumber: number;
  text: string;
}

export interface ExtractionResult {
  pages: ExtractedPage[];
  pageCount: number;
  format: "pdf" | "docx" | "xlsx" | "email";
}

export function extensionOf(filename: string): string {
  const m = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

export function isSupportedUpload(filename: string): boolean {
  return ["pdf", "docx", "xlsx", "xls", "eml", "msg"].includes(extensionOf(filename));
}

/* ------------------------------ DOCX ------------------------------ */

function htmlTableToMarkdown(tableHtml: string): string {
  const rows = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  const lines: string[] = [];
  let isFirstRow = true;
  for (const row of rows) {
    const cells = [...row[1].matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map((c) =>
      c[1]
        .replace(/<[^>]+>/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    );
    if (!cells.length) continue;
    lines.push(`| ${cells.join(" | ")} |`);
    if (isFirstRow) {
      lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
      isFirstRow = false;
    }
  }
  return lines.join("\n");
}

/** Converts mammoth HTML into plain text, keeping <table>s as pipe-markdown blocks. */
function docxHtmlToText(html: string): string {
  const withTables = html.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_m, inner: string) => `\n\n${htmlTableToMarkdown(inner)}\n\n`);
  return withTables
    .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, (_m, inner: string) => `\n\n${inner.replace(/<[^>]+>/g, "").trim()}\n\n`)
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner: string) => `\n- ${inner.replace(/<[^>]+>/g, "").trim()}`)
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractDocx(buffer: Buffer): Promise<ExtractionResult> {
  const mammoth = await import("mammoth");
  const { value: html } = await mammoth.convertToHtml({ buffer });
  const text = docxHtmlToText(html);
  // Pseudo-page the continuous text (~3000 chars/page) so citations stay useful.
  const pages: ExtractedPage[] = [];
  const target = 3000;
  let cursor = 0;
  let pageNum = 1;
  while (cursor < text.length) {
    let end = Math.min(cursor + target, text.length);
    if (end < text.length) {
      const breakAt = text.lastIndexOf("\n\n", end);
      if (breakAt > cursor + target * 0.5) end = breakAt;
    }
    pages.push({ pageNumber: pageNum++, text: text.slice(cursor, end).trim() });
    cursor = end;
  }
  return { pages, pageCount: pages.length, format: "docx" };
}

/* ------------------------------ XLSX ------------------------------ */

async function extractXlsx(buffer: Buffer): Promise<ExtractionResult> {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const pages: ExtractedPage[] = [];
  workbook.eachSheet((sheet: Worksheet) => {
    const lines: string[] = [`## Sheet: ${sheet.name}`];
    let rowCount = 0;
    sheet.eachRow((row: Row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell: Cell) => {
        const v = cell.value;
        let s = "";
        if (v === null || v === undefined) s = "";
        else if (typeof v === "object" && "text" in (v as object)) s = String((v as { text: unknown }).text ?? "");
        else if (typeof v === "object" && "result" in (v as object)) s = String((v as { result: unknown }).result ?? "");
        else s = String(v);
        cells.push(s.replace(/[\r\n|]+/g, " ").trim());
      });
      // Trim trailing empties for compactness
      while (cells.length && !cells[cells.length - 1]) cells.pop();
      if (!cells.length) return;
      lines.push(`| ${cells.join(" | ")} |`);
      if (++rowCount === 1) lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
    });
    const text = lines.join("\n");
    if (text.trim()) pages.push({ pageNumber: pages.length + 1, text });
  });
  if (!pages.length) throw new Error("The spreadsheet contains no readable data.");
  return { pages, pageCount: pages.length, format: "xlsx" };
}

/* ------------------------------ Email (.eml / .msg) ------------------------------ */

interface ParsedEmail {
  subject: string;
  from: string;
  to: string;
  date: string;
  body: string;
}

function decodeQuotedPrintable(input: string): string {
  return input
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

function decodeBody(body: string, encoding: string, charset: string): string {
  try {
    const enc = encoding.toLowerCase();
    if (enc.includes("base64")) {
      return Buffer.from(body.replace(/\s+/g, ""), "base64").toString((charset || "utf8") as BufferEncoding);
    }
    if (enc.includes("quoted-printable")) {
      return decodeQuotedPrintable(body);
    }
    return body;
  } catch {
    return body;
  }
}

function paramHeader(value: string, param: string): string | null {
  const m = value.match(new RegExp(`${param}="?([^";]+)"?`, "i"));
  return m ? m[1].trim() : null;
}

function parseEml(raw: string): ParsedEmail {
  const headerBlockEnd = raw.search(/\r?\n\r?\n/);
  const sepLen = raw.slice(headerBlockEnd).startsWith("\r\n\r\n") ? 4 : 2;
  const headerBlock = raw.slice(0, headerBlockEnd);
  const rest = raw.slice(headerBlockEnd + sepLen);

  const getHeader = (name: string): string => {
    const re = new RegExp(`^${name}:\\s*([\\s\\S]*?)(?=\\r?\\n[^ \\t]|$)`, "gim");
    const m = headerBlock.match(re);
    return m ? m[0].split(":").slice(1).join(":").trim() : "";
  };

  const contentType = getHeader("Content-Type") || "text/plain";
  const boundaryMatch = contentType.match(/boundary="?([^";]+)"?/i);

  let body = "";
  if (boundaryMatch) {
    const boundary = "--" + boundaryMatch[1];
    const parts = rest.split(boundary);
    for (const part of parts) {
      if (part.startsWith("--")) continue; // final delimiter
      const partEnd = part.search(/\r?\n\r?\n/);
      if (partEnd < 0) continue;
      const partHeaders = part.slice(0, partEnd);
      const partBody = part.slice(partEnd).replace(/^\r?\n\r?\n/, "").replace(/\r?\n$/, "");
      const pCt = partHeaders.match(/^Content-Type:\s*([\s\S]*?)(?=\r?\n\S)/im)?.[1] ?? "text/plain";
      if (/^Content-Type:\s*text\/(plain|html)/im.test(partHeaders) || /text\/(plain|html)/i.test(pCt)) {
        const cte = partHeaders.match(/^Content-Transfer-Encoding:\s*(\S+)/im)?.[1] ?? "";
        const charset = paramHeader(pCt, "charset") ?? "utf8";
        let decoded = decodeBody(partBody, cte, charset);
        if (/text\/html/i.test(pCt)) decoded = decoded.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ");
        body += decoded + "\n\n";
      }
    }
  } else {
    const cte = headerBlock.match(/^Content-Transfer-Encoding:\s*(\S+)/im)?.[1] ?? "";
    const charset = paramHeader(contentType, "charset") ?? "utf8";
    body = decodeBody(rest, cte, charset);
    if (/text\/html/i.test(contentType)) body = body.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ");
  }

  return {
    subject: getHeader("Subject"),
    from: getHeader("From"),
    to: getHeader("To"),
    date: getHeader("Date"),
    body: body.trim(),
  };
}

async function extractEmail(buffer: Buffer, filename: string): Promise<ExtractionResult> {
  let parsed: ParsedEmail;
  if (extensionOf(filename) === "msg") {
    // Outlook binary .msg — best-effort via msgreader when available.
    try {
      const mod = await import("@kenjiuno/msgreader");
      const MsgReader = (mod as { MsgReader?: unknown }).MsgReader ?? mod.default;
      type MsgReaderInstance = { getFileData(): { subject?: string; senderName?: string; body?: string } };
      const reader = new (MsgReader as new (data: Uint8Array) => MsgReaderInstance)(new Uint8Array(buffer));
      const data = reader.getFileData();
      parsed = {
        subject: data.subject ?? "",
        from: data.senderName ?? "",
        to: "",
        date: "",
        body: (data.body ?? "").trim(),
      };
    } catch {
      throw new Error(
        "Could not parse this Outlook .msg export. Re-export the message as .eml and upload again."
      );
    }
  } else {
    parsed = parseEml(buffer.toString("utf8"));
  }

  const header = [
    parsed.subject ? `Subject: ${parsed.subject}` : "",
    parsed.from ? `From: ${parsed.from}` : "",
    parsed.to ? `To: ${parsed.to}` : "",
    parsed.date ? `Date: ${parsed.date}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const full = `${header}\n\n${parsed.body}`.trim();
  if (!full) throw new Error("The email export contains no readable body text.");

  const pages: ExtractedPage[] = [];
  const target = 3000;
  let cursor = 0;
  let pageNum = 1;
  while (cursor < full.length) {
    let end = Math.min(cursor + target, full.length);
    if (end < full.length) {
      const breakAt = full.lastIndexOf("\n\n", end);
      if (breakAt > cursor + target * 0.5) end = breakAt;
    }
    pages.push({ pageNumber: pageNum++, text: full.slice(cursor, end).trim() });
    cursor = end;
  }
  return { pages, pageCount: pages.length, format: "email" };
}

/* ------------------------------ Dispatch ------------------------------ */

export async function extractAnyDocument(buffer: Buffer, filename: string): Promise<ExtractionResult> {
  switch (extensionOf(filename)) {
    case "pdf":
      return { ...(await extractPdfPages(buffer)), format: "pdf" };
    case "docx":
      return extractDocx(buffer);
    case "xlsx":
    case "xls":
      return extractXlsx(buffer);
    case "eml":
    case "msg":
      return extractEmail(buffer, filename);
    default:
      throw new Error(
        `Unsupported format ".${extensionOf(filename)}". Supported: PDF, DOCX, XLSX, EML, MSG.`
      );
  }
}
