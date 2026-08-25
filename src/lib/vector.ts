import * as lancedb from "@lancedb/lancedb";
import { mkdirSync } from "node:fs";
import { lanceDbDir } from "./config";

/** table.search() overloads produce a union; pin to the vector variant for chaining. */
function cosineSearch(table: lancedb.Table, vector: number[]): lancedb.VectorQuery {
  return (table.search(vector) as unknown as lancedb.VectorQuery).distanceType("cosine");
}

declare global {
  // eslint-disable-next-line no-var
  var __crispLance: lancedb.Connection | undefined;
}

export async function getVectorDb(): Promise<lancedb.Connection> {
  if (!globalThis.__crispLance) {
    mkdirSync(lanceDbDir(), { recursive: true });
    globalThis.__crispLance = await lancedb.connect(lanceDbDir());
  }
  return globalThis.__crispLance;
}

async function openOrCreateTable(name: string, sampleRows: Record<string, unknown>[]): Promise<lancedb.Table> {
  const db = await getVectorDb();
  const names = await db.tableNames();
  if (names.includes(name)) return await db.openTable(name);
  return await db.createTable(name, sampleRows.length ? sampleRows : [emptyRow(name)]);
}

function emptyRow(name: string): Record<string, unknown> {
  if (name === "chunks") {
    return { vector: Array(EMBED_DIM).fill(0), id: "", document_id: "", workspace_id: "", page_number: 0, section_label: "", text: "" };
  }
  return {
    vector: Array(EMBED_DIM).fill(0),
    id: "",
    workspace_id: "",
    document_id: "",
    scope: "document",
  };
}

/**
 * Embedding dimension is fixed by the configured model; we detect it lazily on first write.
 * MiniLM-L6-v2 -> 384.
 */
export let EMBED_DIM = 384;
export function setEmbedDim(dim: number) {
  if (dim > 0 && dim !== EMBED_DIM) EMBED_DIM = dim;
}

export interface ChunkVectorRow {
  id: string;
  document_id: string;
  workspace_id: string;
  page_number: number;
  section_label: string;
  text: string;
  [key: string]: unknown;
}

export async function upsertChunkVectors(rows: (ChunkVectorRow & { vector: number[] })[]) {
  if (!rows.length) return;
  setEmbedDim(rows[0].vector.length);
  const table = await openOrCreateTable("chunks", rows);
  await table.add(rows as unknown as Record<string, unknown>[], { mode: "append" });
}

export async function deleteVectorsForDocument(documentId: string) {
  const db = await getVectorDb();
  const names = await db.tableNames();
  if (!names.includes("chunks")) return;
  const table = await db.openTable("chunks");
  await table.delete(`document_id = '${documentId}'`);
}

export async function searchChunks(vector: number[], documentIds: string[], topK: number): Promise<ChunkVectorRow[]> {
  const db = await getVectorDb();
  const names = await db.tableNames();
  if (!names.includes("chunks") || !documentIds.length) return [];
  const table = await db.openTable("chunks");
  const filter = `document_id IN (${documentIds.map((d) => `'${d}'`).join(",")})`;
  const rows = (await cosineSearch(table, vector)
    .where(filter)
    .limit(Math.min(topK * 3, 200))
    .toArray()) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    document_id: String(r.document_id),
    workspace_id: String(r.workspace_id),
    page_number: Number(r.page_number),
    section_label: (r.section_label as string) || "",
    text: String(r.text),
  }));
}

export interface CorrectionIndexHit {
  id: string;
  similarity: number;
}

export interface CorrectionVectorRow {
  id: string;
  workspace_id: string;
  document_id: string;
  scope: string;
  [key: string]: unknown;
}

export async function upsertCorrectionVectors(rows: CorrectionVectorRow[]) {
  if (!rows.length) return;
  setEmbedDim((rows[0] as CorrectionVectorRow & { vector?: number[] }).vector?.length ?? EMBED_DIM);
  const table = await openOrCreateTable("corrections_index", rows);
  await table.add(rows, { mode: "append" });
}

export async function removeCorrectionVector(id: string) {
  const db = await getVectorDb();
  const names = await db.tableNames();
  if (!names.includes("corrections_index")) return;
  const table = await db.openTable("corrections_index");
  await table.delete(`id = '${id}'`);
}

export async function searchCorrections(vector: number[], workspaceId: string, documentIds: string[], threshold: number): Promise<CorrectionIndexHit[]> {
  const db = await getVectorDb();
  const names = await db.tableNames();
  if (!names.includes("corrections_index")) return [];
  const table = await db.openTable("corrections_index");
  const filter = `workspace_id = '${workspaceId}' AND (scope = 'workspace' OR document_id IN (${documentIds
    .map((d) => `'${d}'`)
    .join(",")}))`;
  const rows = (await cosineSearch(table, vector)
    .where(filter)
    .limit(20)
    .toArray()) as unknown as Array<Record<string, unknown>>;
  return rows
    .map((r) => ({ id: String(r.id), similarity: 1 - Number(r._distance) }))
    .filter((h) => h.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity);
}
