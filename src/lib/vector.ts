import * as lancedb from "@lancedb/lancedb";
import { mkdirSync } from "node:fs";
import { lanceDbDir } from "./config";

/** table.search() overloads produce a union; pin to the vector variant for chaining. */
function cosineSearch(table: lancedb.Table, vector: number[]): lancedb.VectorQuery {
  return (table.search(vector) as unknown as lancedb.VectorQuery).distanceType("cosine");
}

declare global {
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

/**
 * LanceDB filters are SQL-ish strings without bound parameters; document ids
 * are always internally generated `doc_<uuid>` values, and we escape quotes
 * anyway so no external input can break out of the literal.
 */
function safeFilterValue(value: string): string {
  if (!/^doc_[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`Refusing to build filter for unexpected id format: ${value.slice(0, 8)}...`);
  }
  return value.replace(/'/g, "''");
}

export async function deleteVectorsForDocument(documentId: string) {
  const db = await getVectorDb();
  const names = await db.tableNames();
  if (!names.includes("chunks")) return;
  const table = await db.openTable("chunks");
  await table.delete(`document_id = '${safeFilterValue(documentId)}'`);
}

function simFromDistance(r: Record<string, unknown>): number {
  const d = Number(r._distance);
  return Number.isFinite(d) ? 1 - d : 0;
}

export async function searchChunks(vector: number[], documentIds: string[], topK: number): Promise<RetrievedChunkRow[]> {
  const db = await getVectorDb();
  const names = await db.tableNames();
  if (!names.includes("chunks") || !documentIds.length) return [];
  const table = await db.openTable("chunks");
  const filter = `document_id IN (${documentIds.map((d) => `'${d}'`).join(",")})`;
  const rows = (await cosineSearch(table, vector)
    .where(filter)
    .limit(Math.min(topK * 3, 200))
    .toArray()) as unknown as Array<Record<string, unknown>>;
  return rows
    .map((r) => ({
      id: String(r.id),
      document_id: String(r.document_id),
      workspace_id: String(r.workspace_id),
      page_number: Number(r.page_number),
      section_label: (r.section_label as string) || "",
      text: String(r.text),
      score: simFromDistance(r),
    }))
    .sort((a, b) => b.score - a.score);
}

export interface RetrievedChunkRow {
  id: string;
  document_id: string;
  workspace_id: string;
  page_number: number;
  section_label: string;
  text: string;
  score: number;
}

/**
 * Non-vector scan of a workspace's chunks — used by conflict detection and
 * compounding suggestions. Capped to keep local scans fast.
 */
export async function listWorkspaceChunks(workspaceId: string, limit = 2000): Promise<Array<ChunkVectorRow & { vector: number[] }>> {
  const db = await getVectorDb();
  const names = await db.tableNames();
  if (!names.includes("chunks")) return [];
  const table = await db.openTable("chunks");
  const rows = (await table
    .query()
    .where(`workspace_id = '${workspaceId}'`)
    .limit(limit)
    .toArray()) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    document_id: String(r.document_id),
    workspace_id: String(r.workspace_id),
    page_number: Number(r.page_number),
    section_label: (r.section_label as string) || "",
    text: String(r.text),
    vector: (r.vector as number[]) ?? [],
  }));
}

/** Cross-document similar-passage search used by FR-50 suggestion generation. */
export async function searchChunksWorkspace(
  vector: number[],
  workspaceId: string,
  excludeDocumentIds: string[],
  limit = 8
): Promise<RetrievedChunkRow[]> {
  const db = await getVectorDb();
  const names = await db.tableNames();
  if (!names.includes("chunks")) return [];
  const table = await db.openTable("chunks");
  const exclusions = excludeDocumentIds.length
    ? ` AND document_id NOT IN (${excludeDocumentIds.map((d) => `'${d}'`).join(",")})`
    : "";
  const rows = (await cosineSearch(table, vector)
    .where(`workspace_id = '${workspaceId}'${exclusions}`)
    .limit(Math.max(limit * 4, 40))
    .toArray()) as unknown as Array<Record<string, unknown>>;
  return rows
    .map((r) => ({
      id: String(r.id),
      document_id: String(r.document_id),
      workspace_id: String(r.workspace_id),
      page_number: Number(r.page_number),
      section_label: (r.section_label as string) || "",
      text: String(r.text),
      score: simFromDistance(r),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
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
  // scope='workspace' corrections match regardless of which docs are in play.
  const filter = `workspace_id = '${workspaceId}' AND (scope = 'workspace' OR document_id IN (${documentIds
    .map((d) => `'${d}'`)
    .join(",")}))`;
  const rows = (await cosineSearch(table, vector)
    .where(filter)
    .limit(20)
    .toArray()) as unknown as Array<Record<string, unknown>>;
  return rows
    .map((r) => ({ id: String(r.id), similarity: simFromDistance(r) }))
    .filter((h) => h.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity);
}
