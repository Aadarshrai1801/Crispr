import { extractText, getDocumentProxy } from "unpdf";

export interface ExtractedPage {
  pageNumber: number;
  text: string;
}

export async function extractPdfPages(buffer: Buffer): Promise<{ pages: ExtractedPage[]; pageCount: number }> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pageTexts = Array.isArray(text) ? text : [text];
  return {
    pages: pageTexts.map((t, i) => ({ pageNumber: i + 1, text: t ?? "" })),
    pageCount: totalPages,
  };
}
