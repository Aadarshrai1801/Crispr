import { storageBackend } from "./config";
import * as local from "./vector-local";
import * as supabase from "./vector-supabase";

/**
 * Vector-storage facade.
 *
 * `local` (default) uses LanceDB on the local filesystem; `supabase` uses the
 * Postgres `chunks` / `corrections_index` tables with pgvector. Selection is
 * driven by `storageBackend()` (see config), identical to the `db.ts` facade.
 * Every operation here is async so callers work against either backend.
 *
 * NOTE: The pgvector extension and tables must exist (run
 * `src/lib/schema-pg.sql`) before the supabase backend can be used.
 */

const isSupabase = () => storageBackend() === "supabase";

// Embedding dimension detection is shared so both backends agree on shape.
export let EMBED_DIM = 384;
export function setEmbedDim(dim: number) {
  if (dim > 0 && dim !== EMBED_DIM) EMBED_DIM = dim;
}
export type { ChunkVectorRow, RetrievedChunkRow, CorrectionIndexHit, CorrectionVectorRow } from "./vector-local";

export async function upsertChunkVectors(rows: (local.ChunkVectorRow & { vector: number[] })[]) {
  if (!rows.length) return;
  setEmbedDim(rows[0].vector.length);
  return isSupabase()
    ? supabase.upsertChunkVectors(rows as unknown as (supabase.ChunkVectorRow & { vector: number[] })[])
    : local.upsertChunkVectors(rows);
}

export async function deleteVectorsForDocument(documentId: string) {
  return isSupabase() ? supabase.deleteVectorsForDocument(documentId) : local.deleteVectorsForDocument(documentId);
}

export async function searchChunks(vector: number[], documentIds: string[], topK: number): Promise<local.RetrievedChunkRow[]> {
  return isSupabase() ? supabase.searchChunks(vector, documentIds, topK) : local.searchChunks(vector, documentIds, topK);
}

export async function listWorkspaceChunks(workspaceId: string, limit = 2000): Promise<Array<local.ChunkVectorRow & { vector: number[] }>> {
  return isSupabase()
    ? supabase.listWorkspaceChunks(workspaceId, limit)
    : local.listWorkspaceChunks(workspaceId, limit);
}

export async function searchChunksWorkspace(
  vector: number[],
  workspaceId: string,
  excludeDocumentIds: string[],
  limit = 8
): Promise<local.RetrievedChunkRow[]> {
  return isSupabase()
    ? supabase.searchChunksWorkspace(vector, workspaceId, excludeDocumentIds, limit)
    : local.searchChunksWorkspace(vector, workspaceId, excludeDocumentIds, limit);
}

export async function upsertCorrectionVectors(rows: local.CorrectionVectorRow[]) {
  if (!rows.length) return;
  setEmbedDim((rows[0] as local.CorrectionVectorRow & { vector?: number[] }).vector?.length ?? EMBED_DIM);
  return isSupabase()
    ? supabase.upsertCorrectionVectors(rows)
    : local.upsertCorrectionVectors(rows);
}

export async function removeCorrectionVector(id: string) {
  return isSupabase() ? supabase.removeCorrectionVector(id) : local.removeCorrectionVector(id);
}

export async function searchCorrections(vector: number[], workspaceId: string, documentIds: string[], threshold: number): Promise<local.CorrectionIndexHit[]> {
  return isSupabase()
    ? supabase.searchCorrections(vector, workspaceId, documentIds, threshold)
    : local.searchCorrections(vector, workspaceId, documentIds, threshold);
}
