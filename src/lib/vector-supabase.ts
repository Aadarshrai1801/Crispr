import { getPgPool } from "./supabase";
import { embedDim } from "./config";

/**
 * pgvector driver for the Supabase backend. Mirrors the surface of the local
 * (LanceDB) driver in `vector-local.ts`, but backed by the `chunks` and
 * `corrections_index` tables declared in `src/lib/schema-pg.sql`.
 *
 * pgvector's `<=>` is cosine distance; similarity = 1 - distance.
 */

const pool = () => {
  const p = getPgPool();
  if (!p) throw new Error("Postgres pool unavailable (backend is not 'supabase')");
  return p;
};

/** Format a float vector as a pgvector literal. */
function toPgVector(values: number[]): string {
  return `[${values.map((v) => Number(v).toFixed(6)).join(",")}]`;
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

export interface RetrievedChunkRow {
  id: string;
  document_id: string;
  workspace_id: string;
  page_number: number;
  section_label: string;
  text: string;
  score: number;
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

export async function upsertChunkVectors(rows: (ChunkVectorRow & { vector: number[] })[]) {
  if (!rows.length) return;
  const c = await (await pool()).connect();
  try {
    await c.query("BEGIN");
    for (const r of rows) {
      await c.query(
        `INSERT INTO chunks (id, document_id, workspace_id, page_number, section_label, text, embedding)
         VALUES ($1,$2,$3,$4,$5,$6,$7::vector)
         ON CONFLICT (id) DO UPDATE SET
           document_id = EXCLUDED.document_id,
           workspace_id = EXCLUDED.workspace_id,
           page_number = EXCLUDED.page_number,
           section_label = EXCLUDED.section_label,
           text = EXCLUDED.text,
           embedding = EXCLUDED.embedding`,
        [r.id, r.document_id, r.workspace_id, r.page_number, r.section_label || "", r.text || "", toPgVector(r.vector)]
      );
    }
    await c.query("COMMIT");
  } catch (e) {
    try {
      await c.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    c.release();
  }
}

export async function deleteVectorsForDocument(documentId: string) {
  await (await pool()).query(`DELETE FROM chunks WHERE document_id = $1`, [documentId]);
}

export async function searchChunks(vector: number[], documentIds: string[], topK: number): Promise<RetrievedChunkRow[]> {
  if (!documentIds.length) return [];
  const dim = embedDim();
  const { rows } = await (await pool()).query(
    `SELECT id, document_id, workspace_id, page_number, section_label, text,
            (1 - (embedding <=> $1::vector)) AS score
     FROM chunks
     WHERE document_id = ANY($2::text[])
     ORDER BY embedding <=> $1::vector
     LIMIT $3`,
    [toPgVector(vector.slice(0, dim)), documentIds, Math.min(topK * 3, 200)]
  );
  return rows.map((r: Record<string, unknown>) => ({
    id: String(r.id),
    document_id: String(r.document_id),
    workspace_id: String(r.workspace_id),
    page_number: Number(r.page_number),
    section_label: (r.section_label as string) || "",
    text: String(r.text),
    score: numScore(r.score),
  }));
}

export async function listWorkspaceChunks(workspaceId: string, limit = 2000): Promise<Array<ChunkVectorRow & { vector: number[] }>> {
  const { rows } = await (await pool()).query(
    `SELECT id, document_id, workspace_id, page_number, section_label, text, embedding
     FROM chunks WHERE workspace_id = $1 LIMIT $2`,
    [workspaceId, limit]
  );
  return rows.map((r: Record<string, unknown>) => ({
    id: String(r.id),
    document_id: String(r.document_id),
    workspace_id: String(r.workspace_id),
    page_number: Number(r.page_number),
    section_label: (r.section_label as string) || "",
    text: String(r.text),
    vector: pgVectorToArray(r.embedding),
  }));
}

export async function searchChunksWorkspace(
  vector: number[],
  workspaceId: string,
  excludeDocumentIds: string[],
  limit = 8
): Promise<RetrievedChunkRow[]> {
  const dim = embedDim();
  const exclusion = excludeDocumentIds.length ? " AND NOT (document_id = ANY($3::text[]))" : "";
  const params: unknown[] = [toPgVector(vector.slice(0, dim)), workspaceId];
  if (excludeDocumentIds.length) params.push(excludeDocumentIds);
  const { rows } = await (await pool()).query(
    `SELECT id, document_id, workspace_id, page_number, section_label, text,
            (1 - (embedding <=> $1::vector)) AS score
     FROM chunks
     WHERE workspace_id = $2${exclusion}
     ORDER BY embedding <=> $1::vector
     LIMIT $4`,
    [...params, Math.max(limit * 4, 40)]
  );
  return rows
    .map((r: Record<string, unknown>) => ({
      id: String(r.id),
      document_id: String(r.document_id),
      workspace_id: String(r.workspace_id),
      page_number: Number(r.page_number),
      section_label: (r.section_label as string) || "",
      text: String(r.text),
      score: numScore(r.score),
    }))
    .slice(0, limit);
}

export async function upsertCorrectionVectors(rows: CorrectionVectorRow[]) {
  if (!rows.length) return;
  const c = await (await pool()).connect();
  try {
    await c.query("BEGIN");
    for (const r of rows) {
      const vector = (r as CorrectionVectorRow & { vector?: number[] }).vector;
      if (!vector) continue;
      await c.query(
        `INSERT INTO corrections_index (id, workspace_id, document_id, scope, embedding)
         VALUES ($1,$2,$3,$4,$5::vector)
         ON CONFLICT (id) DO UPDATE SET
           workspace_id = EXCLUDED.workspace_id,
           document_id = EXCLUDED.document_id,
           scope = EXCLUDED.scope,
           embedding = EXCLUDED.embedding`,
        [r.id, r.workspace_id, r.document_id, r.scope, toPgVector(vector)]
      );
    }
    await c.query("COMMIT");
  } catch (e) {
    try {
      await c.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    c.release();
  }
}

export async function removeCorrectionVector(id: string) {
  await (await pool()).query(`DELETE FROM corrections_index WHERE id = $1`, [id]);
}

export async function searchCorrections(vector: number[], workspaceId: string, documentIds: string[], threshold: number): Promise<CorrectionIndexHit[]> {
  const dim = embedDim();
  // scope='workspace' corrections match regardless of which docs are in play.
  // With no documents in play, only workspace-scoped corrections are eligible.
  const docClause = documentIds.length ? " OR document_id = ANY($3::text[])" : "";
  const params: unknown[] = [toPgVector(vector.slice(0, dim)), workspaceId];
  if (documentIds.length) params.push(documentIds);
  const { rows } = await (await pool()).query(
    `SELECT id, (1 - (embedding <=> $1::vector)) AS score
     FROM corrections_index
     WHERE workspace_id = $2 AND (scope = 'workspace'${docClause})
     ORDER BY embedding <=> $1::vector
     LIMIT 20`,
    params
  );
  return rows
    .map((r: Record<string, unknown>) => ({ id: String(r.id), similarity: numScore(r.score) }))
    .filter((h) => h.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity);
}

function numScore(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

function pgVectorToArray(v: unknown): number[] {
  if (Array.isArray(v)) return v.map((n) => Number(n));
  const m = typeof v === "string" ? v.match(/[-\d.]+/g) : null;
  return m ? m.map((n) => Number(n)) : [];
}
