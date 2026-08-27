import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import type {
  ApiKeyRow,
  AuditActionType,
  AuditLogEntryRow,
  ChatMessageRole,
  ChatMessageRow,
  ChatSessionRow,
  Citation,
  ConflictAlertRow,
  CorrectionCommentRow,
  CorrectionRow,
  CorrectionScope,
  CorrectionStatus,
  DocumentRow,
  DocumentSourceType,
  DocumentVersionRow,
  FeedbackStatus,
  IntegrationConnectionRow,
  PlanTier,
  QueryLogRow,
  SuggestedCorrectionRow,
  UserRow,
  WebhookEndpointRow,
  WorkspaceMembershipRow,
  WorkspaceRole,
  WorkspaceRow,
} from "./types";
import { getPgPool } from "./supabase";
import { sha256Hex } from "./crypto-utils";

/**
 * Supabase / PostgreSQL driver. Mirrors the surface of the local (SQLite)
 * driver in `db-local.ts`, but async and Postgres-flavoured. Only used when the
 * `supabase` backend is selected. JSON-shaped text columns are stored as TEXT
 * (identical semantics to SQLite) and parsed on the JS side, so row types match.
 */

const pool = () => {
  const p = getPgPool();
  if (!p) throw new Error("Postgres pool unavailable (backend is not 'supabase')");
  return p;
};

export const DEV_SEED_PASSWORD = "demo1234";

// PG borrows a client for the duration of a transaction.
async function withTx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await (await pool()).connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }
}

/** Build `$1,$2,...` placeholders for a count. */
function ph(n: number): string {
  return Array.from({ length: n }, (_, i) => `$${i + 1}`).join(",");
}

/** Convert SQLite `?` placeholders to PostgreSQL `$n`. */
function toPgPlaceholders(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

/** Portable raw query (all rows). Params are positional `?`. */
export async function rawQuery<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool().query(toPgPlaceholders(sql), params);
  return r.rows as T[];
}

/** Portable raw query (first row). Params are positional `?`. */
export async function rawQueryOne<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  const r = await pool().query(toPgPlaceholders(sql), params);
  return r.rows[0] as T | undefined;
}

export function getDb(): { query(sql: string, params?: unknown[]): Promise<pg.QueryResult> } {
  return { query: (sql, params) => pool().query(sql, params) };
}

export const defaultWorkspaceId = () => "ws_default";

/* ------------------------- Users ------------------------- */

export async function listUsers(): Promise<UserRow[]> {
  const r = await pool().query("SELECT * FROM users ORDER BY id");
  return r.rows as UserRow[];
}

export async function getUser(id: string): Promise<UserRow | undefined> {
  const r = await pool().query("SELECT * FROM users WHERE id = $1", [id]);
  return r.rows[0] as UserRow | undefined;
}

export async function getUserByEmail(email: string): Promise<UserRow | undefined> {
  const r = await pool().query("SELECT * FROM users WHERE lower(email) = lower($1)", [email]);
  return r.rows[0] as UserRow | undefined;
}

/* ------------------------- Sessions ------------------------- */

export interface SessionInfo {
  user_id: string;
  expires_at: string;
}

export async function createSession(userId: string, ttlMs: number): Promise<{ token: string; expires_at: string }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  await pool().query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)", [
    sha256Hex(token),
    userId,
    expiresAt,
  ]);
  await pool().query("DELETE FROM sessions WHERE expires_at < now()");
  return { token, expires_at: expiresAt };
}

export async function getSession(token: string): Promise<SessionInfo | undefined> {
  const r = await pool().query(
    "SELECT user_id, expires_at FROM sessions WHERE token_hash = $1 AND expires_at >= now()",
    [sha256Hex(token)]
  );
  return r.rows[0] as SessionInfo | undefined;
}

export async function deleteSession(token: string): Promise<void> {
  await pool().query("DELETE FROM sessions WHERE token_hash = $1", [sha256Hex(token)]);
}

/* ------------------------- Ingestion queue (durable, N12) ------------------------- */

export interface IngestJobRow {
  id: string;
  document_id: string;
  status: "pending" | "processing" | "done" | "failed";
  attempts: number;
  last_error: string | null;
}

export async function enqueueIngestJob(documentId: string): Promise<void> {
  await pool().query("INSERT INTO ingest_jobs (id, document_id) VALUES ($1, $2) ON CONFLICT (document_id) DO NOTHING", [
    "job_" + randomUUID(),
    documentId,
  ]);
}

export async function claimNextIngestJob(): Promise<IngestJobRow | undefined> {
  const r = await pool().query(
    "SELECT * FROM ingest_jobs WHERE status IN ('pending','processing') ORDER BY created_at ASC LIMIT 1"
  );
  const row = r.rows[0] as IngestJobRow | undefined;
  if (!row) return undefined;
  await pool().query(
    "UPDATE ingest_jobs SET status='processing', attempts = attempts + 1, updated_at = now() WHERE id = $1",
    [row.id]
  );
  return { ...row, status: "processing", attempts: row.attempts + 1 };
}

export async function completeIngestJob(jobId: string): Promise<void> {
  await pool().query("UPDATE ingest_jobs SET status='done', last_error=NULL, updated_at=now() WHERE id = $1", [jobId]);
}

export async function failIngestJob(jobId: string, error: string, willRetry: boolean): Promise<void> {
  await pool().query("UPDATE ingest_jobs SET status=$1, last_error=$2, updated_at=now() WHERE id = $3", [
    willRetry ? "pending" : "failed",
    error.slice(0, 500),
    jobId,
  ]);
}

/* ------------------------- Workspaces ------------------------- */

export interface NewWorkspaceInput {
  id?: string;
  name: string;
  owner_id: string;
  approval_required?: boolean;
  confidence_threshold?: number;
  plan_tier?: PlanTier;
}

export async function insertWorkspace(input: NewWorkspaceInput): Promise<WorkspaceRow> {
  const id = input.id ?? "ws_" + randomUUID();
  await pool().query(
    `INSERT INTO workspaces (id, name, owner_id, member_ids, approval_required, confidence_threshold, plan_tier)
     VALUES ($1, $2, $3, '[]', $4, $5, $6)`,
    [
      id,
      input.name,
      input.owner_id,
      input.approval_required ? 1 : 0,
      input.confidence_threshold ?? 0.55,
      input.plan_tier ?? "team",
    ]
  );
  await pool().query(
    "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'Admin') ON CONFLICT DO NOTHING",
    [id, input.owner_id]
  );
  return (await getWorkspace(id))!;
}

export async function updateWorkspaceSettings(
  id: string,
  patch: Partial<Pick<WorkspaceRow, "name" | "confidence_threshold" | "plan_tier">> & { approval_required?: boolean }
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.name !== undefined) {
    sets.push(`name = $${params.length + 1}`);
    params.push(patch.name);
  }
  if (patch.approval_required !== undefined) {
    sets.push(`approval_required = $${params.length + 1}`);
    params.push(patch.approval_required ? 1 : 0);
  }
  if (patch.confidence_threshold !== undefined) {
    sets.push(`confidence_threshold = $${params.length + 1}`);
    params.push(patch.confidence_threshold);
  }
  if (patch.plan_tier !== undefined) {
    sets.push(`plan_tier = $${params.length + 1}`);
    params.push(patch.plan_tier);
  }
  if (!sets.length) return;
  params.push(id);
  await pool().query(`UPDATE workspaces SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
}

export async function getWorkspace(id: string): Promise<WorkspaceRow | undefined> {
  const r = await pool().query("SELECT * FROM workspaces WHERE id = $1", [id]);
  return r.rows[0] as WorkspaceRow | undefined;
}

export async function listWorkspacesForUser(userId: string): Promise<WorkspaceRow[]> {
  const r = await pool().query(
    `SELECT w.* FROM workspaces w
     JOIN workspace_members m ON m.workspace_id = w.id
     WHERE m.user_id = $1
     ORDER BY (w.id = 'ws_default') DESC, w.created_at ASC`,
    [userId]
  );
  return r.rows as WorkspaceRow[];
}

/* ------------------------- Memberships ------------------------- */

export interface NewMembershipInput {
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
}

export async function upsertMember(m: NewMembershipInput): Promise<WorkspaceMembershipRow> {
  await pool().query(
    `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)
     ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = excluded.role`,
    [m.workspace_id, m.user_id, m.role]
  );
  return (await getMembership(m.workspace_id, m.user_id))!;
}

export async function getMembership(workspaceId: string, userId: string): Promise<WorkspaceMembershipRow | undefined> {
  const r = await pool().query("SELECT * FROM workspace_members WHERE workspace_id = $1 AND user_id = $2", [
    workspaceId,
    userId,
  ]);
  return r.rows[0] as WorkspaceMembershipRow | undefined;
}

export async function listMembers(workspaceId: string): Promise<(WorkspaceMembershipRow & { name: string; email: string })[]> {
  const r = await pool().query(
    `SELECT m.*, u.name, u.email FROM workspace_members m
     JOIN users u ON u.id = m.user_id
     WHERE m.workspace_id = $1
     ORDER BY CASE m.role WHEN 'Admin' THEN 0 WHEN 'Approver' THEN 1 WHEN 'Contributor' THEN 2 ELSE 3 END, m.joined_at`,
    [workspaceId]
  );
  return r.rows as (WorkspaceMembershipRow & { name: string; email: string })[];
}

export async function removeMember(workspaceId: string, userId: string): Promise<void> {
  await pool().query("DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2", [workspaceId, userId]);
}

export async function countMembers(workspaceId: string): Promise<number> {
  const r = await pool().query("SELECT COUNT(*) AS n FROM workspace_members WHERE workspace_id = $1", [workspaceId]);
  return Number(r.rows[0].n);
}

export async function deleteWorkspaceCascade(workspaceId: string): Promise<void> {
  await withTx(async (c) => {
    const docRes = await c.query("SELECT id FROM documents WHERE workspace_id = $1", [workspaceId]);
    const docIds = (docRes.rows as Array<{ id: string }>).map((r) => r.id);
    const corrRes = await c.query("SELECT id FROM corrections WHERE workspace_id = $1", [workspaceId]);
    const corrIds = (corrRes.rows as Array<{ id: string }>).map((r) => r.id);

    if (docIds.length) {
      const p = ph(docIds.length);
      await c.query(`DELETE FROM document_versions WHERE document_id IN (${p})`, docIds);
      await c.query(`DELETE FROM ingest_jobs WHERE document_id IN (${p})`, docIds);
      await c.query(`DELETE FROM documents WHERE id IN (${p})`, docIds);
    }
    if (corrIds.length) {
      const p = ph(corrIds.length);
      await c.query(`DELETE FROM correction_comments WHERE correction_id IN (${p})`, corrIds);
      await c.query(`DELETE FROM corrections WHERE id IN (${p})`, corrIds);
    }
    for (const table of [
      "conflict_alerts",
      "suggested_corrections",
      "integration_connections",
      "api_keys",
      "webhook_endpoints",
      "audit_log",
      "query_logs",
    ]) {
      await c.query(`DELETE FROM ${table} WHERE workspace_id = $1`, [workspaceId]);
    }
    const sessRes = await c.query("SELECT id FROM chat_sessions WHERE workspace_id = $1", [workspaceId]);
    const sessIds = (sessRes.rows as Array<{ id: string }>).map((r) => r.id);
    if (sessIds.length) {
      const p = ph(sessIds.length);
      await c.query(`DELETE FROM chat_messages WHERE session_id IN (${p})`, sessIds);
      await c.query(`DELETE FROM chat_sessions WHERE id IN (${p})`, sessIds);
    }
    await c.query("DELETE FROM workspace_members WHERE workspace_id = $1", [workspaceId]);
    await c.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
  });
}

/* ------------------------- Documents ------------------------- */

export type NewDocumentInput = Omit<DocumentRow, "created_at" | "ocr_warning" | "source_type" | "source_connection_id" | "current_version_id" | "version_number"> & {
  ocr_warning?: boolean | number;
  source_type?: DocumentSourceType;
  source_connection_id?: string | null;
  current_version_id?: string | null;
  version_number?: number;
};

export async function insertDocument(doc: NewDocumentInput): Promise<void> {
  await pool().query(
    `INSERT INTO documents (id, workspace_id, owner_id, filename, storage_path, page_count, status, file_hash, ocr_warning, error, source_type, source_connection_id, current_version_id, version_number)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      doc.id,
      doc.workspace_id,
      doc.owner_id,
      doc.filename,
      doc.storage_path,
      doc.page_count ?? 0,
      doc.status,
      doc.file_hash,
      doc.ocr_warning ? 1 : 0,
      doc.error ?? null,
      doc.source_type ?? "upload",
      doc.source_connection_id ?? null,
      doc.current_version_id ?? null,
      doc.version_number ?? 1,
    ]
  );
}

export async function updateDocumentStatus(
  id: string,
  patch: Partial<Pick<DocumentRow, "status" | "page_count" | "error" | "current_version_id" | "version_number" | "filename" | "file_hash" | "storage_path">> & { ocr_warning?: boolean }
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (col: string, val: unknown) => {
    sets.push(`${col} = $${params.length + 1}`);
    params.push(val);
  };
  if (patch.status !== undefined) push("status", patch.status);
  if (patch.page_count !== undefined) push("page_count", patch.page_count);
  if (patch.ocr_warning !== undefined) push("ocr_warning", patch.ocr_warning ? 1 : 0);
  if (patch.error !== undefined) push("error", patch.error);
  if (patch.current_version_id !== undefined) push("current_version_id", patch.current_version_id);
  if (patch.version_number !== undefined) push("version_number", patch.version_number);
  if (patch.filename !== undefined) push("filename", patch.filename);
  if (patch.file_hash !== undefined) push("file_hash", patch.file_hash);
  if (patch.storage_path !== undefined) push("storage_path", patch.storage_path);
  if (!sets.length) return;
  params.push(id);
  await pool().query(`UPDATE documents SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
}

export async function getDocument(id: string): Promise<DocumentRow | undefined> {
  const r = await pool().query("SELECT * FROM documents WHERE id = $1", [id]);
  return r.rows[0] as DocumentRow | undefined;
}

export async function listDocuments(workspaceId: string): Promise<DocumentRow[]> {
  const r = await pool().query("SELECT * FROM documents WHERE workspace_id = $1 ORDER BY created_at DESC", [workspaceId]);
  return r.rows as DocumentRow[];
}

export async function countDocuments(workspaceId: string): Promise<number> {
  const r = await pool().query("SELECT COUNT(*) AS n FROM documents WHERE workspace_id = $1", [workspaceId]);
  return Number(r.rows[0].n);
}

export async function findDocumentByHash(hash: string, workspaceId?: string): Promise<DocumentRow | undefined> {
  if (workspaceId) {
    const r = await pool().query(
      "SELECT * FROM documents WHERE file_hash = $1 AND workspace_id = $2 AND status != 'failed' ORDER BY created_at DESC LIMIT 1",
      [hash, workspaceId]
    );
    return r.rows[0] as DocumentRow | undefined;
  }
  const r = await pool().query(
    "SELECT * FROM documents WHERE file_hash = $1 AND status != 'failed' ORDER BY created_at DESC LIMIT 1",
    [hash]
  );
  return r.rows[0] as DocumentRow | undefined;
}

export async function deleteDocument(id: string): Promise<void> {
  await pool().query("DELETE FROM documents WHERE id = $1", [id]);
}

/* ------------------------- Document versions ------------------------- */

export interface NewDocumentVersionInput {
  id?: string;
  document_id: string;
  version_number: number;
  uploaded_by: string;
  diff_summary: string | null;
  storage_path: string;
  file_hash: string;
  page_count: number;
}

export async function insertDocumentVersion(v: NewDocumentVersionInput): Promise<DocumentVersionRow> {
  const id = v.id ?? "dver_" + randomUUID();
  await pool().query(
    `INSERT INTO document_versions (id, document_id, version_number, uploaded_by, diff_summary, storage_path, file_hash, page_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, v.document_id, v.version_number, v.uploaded_by, v.diff_summary, v.storage_path, v.file_hash, v.page_count]
  );
  return (await getDocumentVersion(id))!;
}

export async function getDocumentVersion(id: string): Promise<DocumentVersionRow | undefined> {
  const r = await pool().query("SELECT * FROM document_versions WHERE id = $1", [id]);
  return r.rows[0] as DocumentVersionRow | undefined;
}

export async function listDocumentVersions(documentId: string): Promise<DocumentVersionRow[]> {
  const r = await pool().query("SELECT * FROM document_versions WHERE document_id = $1 ORDER BY version_number DESC", [
    documentId,
  ]);
  return r.rows as DocumentVersionRow[];
}

/* ------------------------- Query logs ------------------------- */

const parseQl = (row: QueryLogRow): QueryLogRow => row;

export interface NewQueryLogInput extends Omit<QueryLogRow, "created_at" | "document_ids" | "citations" | "correction_id" | "flagged_needs_review" | "confidence_score" | "confidence_threshold"> {
  document_ids: string[];
  citations?: Citation[];
  correction_id?: string | null;
  confidence_score?: number | null;
  confidence_threshold?: number | null;
  flagged_needs_review?: boolean;
}

export async function insertQueryLog(ql: NewQueryLogInput): Promise<void> {
  await pool().query(
    `INSERT INTO query_logs (id, workspace_id, user_id, document_ids, question_text, answer_text, source_type, citations, correction_id, feedback_status, retry_of, attempt, strategy_note, confidence_score, confidence_threshold, flagged_needs_review)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [
      ql.id,
      ql.workspace_id,
      ql.user_id,
      JSON.stringify(ql.document_ids),
      ql.question_text,
      ql.answer_text,
      ql.source_type,
      JSON.stringify(ql.citations ?? []),
      ql.correction_id ?? null,
      ql.feedback_status ?? "none",
      ql.retry_of ?? null,
      ql.attempt,
      ql.strategy_note,
      ql.confidence_score ?? null,
      ql.confidence_threshold ?? null,
      ql.flagged_needs_review ? 1 : 0,
    ]
  );
}

export async function getQueryLog(id: string): Promise<QueryLogRow | undefined> {
  const r = await pool().query("SELECT * FROM query_logs WHERE id = $1", [id]);
  const row = r.rows[0] as QueryLogRow | undefined;
  return row ? parseQl(row) : undefined;
}

export async function setFeedbackStatus(id: string, status: FeedbackStatus): Promise<void> {
  await pool().query("UPDATE query_logs SET feedback_status = $1 WHERE id = $2", [status, id]);
}

export async function listFlaggedLogsSince(workspaceId: string, sinceIso: string): Promise<QueryLogRow[]> {
  const r = await pool().query(
    `SELECT * FROM query_logs
     WHERE workspace_id = $1 AND feedback_status = 'flagged' AND created_at >= $2 AND source_type != 'no_answer'
     ORDER BY created_at DESC LIMIT 500`,
    [workspaceId, sinceIso]
  );
  return r.rows as QueryLogRow[];
}

export async function hasActiveCorrectionForQuestions(workspaceId: string): Promise<Set<string>> {
  const r = await pool().query(
    "SELECT LOWER(TRIM(question_text)) AS q FROM corrections WHERE workspace_id = $1 AND status IN ('active','pending')",
    [workspaceId]
  );
  return new Set((r.rows as Array<{ q: string }>).map((x) => x.q));
}

export async function countRetryChain(queryLogId: string): Promise<number> {
  let current = await getQueryLog(queryLogId);
  let depth = 0;
  while (current?.retry_of && depth < 10) {
    current = await getQueryLog(current.retry_of);
    depth++;
  }
  return current ? current.attempt : 0;
}

export async function findCachedAnswer(workspaceId: string, normalizedQuestion: string, documentIds: string[]): Promise<QueryLogRow | undefined> {
  const r = await pool().query(
    `SELECT * FROM query_logs
     WHERE workspace_id = $1
       AND REPLACE(LOWER(TRIM(question_text)), ' ', '') = $2
       AND source_type IN ('document', 'correction')
       AND feedback_status = 'none'
     ORDER BY created_at DESC LIMIT 5`,
    [workspaceId, normalizedQuestion.replace(/\s+/g, "")]
  );
  for (const row of r.rows as QueryLogRow[]) {
    try {
      const ids: string[] = JSON.parse(row.document_ids);
      if (!documentIds.some((d) => ids.includes(d))) continue;
    } catch {
      /* ignore malformed */
    }
    const cRes = await pool().query(
      `SELECT MAX(updated_at) AS ts FROM corrections
       WHERE workspace_id = $1 AND status IN ('active', 'superseded') AND (scope = 'workspace' OR document_id = ANY($2::text[]))`,
      [workspaceId, documentIds.length ? documentIds : null]
    );
    const latestCorrectionAt = cRes.rows[0] as { ts: string | null };
    if (!latestCorrectionAt?.ts || latestCorrectionAt.ts <= row.created_at) return parseQl(row);
  }
}

/* ------------------------- Corrections ------------------------- */

export interface NewCorrectionInput {
  id?: string;
  workspace_id: string;
  document_id: string | null;
  original_query_log_id: string;
  question_text: string;
  topic_tags: string[];
  wrong_answer_text: string;
  corrected_answer_text: string;
  note: string | null;
  submitted_by: string;
  supersedes_correction_id: string | null;
  scope: CorrectionScope;
  status?: CorrectionStatus;
  approved_by?: string | null;
  suggested_correction_id?: string | null;
}

export async function insertCorrection(input: NewCorrectionInput): Promise<CorrectionRow> {
  const id = input.id ?? "corr_" + randomUUID();
  const status = input.status ?? "active";
  await pool().query(
    `INSERT INTO corrections (id, workspace_id, document_id, original_query_log_id, question_text, topic_tags, wrong_answer_text, corrected_answer_text, note, submitted_by, supersedes_correction_id, scope, status, approved_by, approved_at, suggested_correction_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [
      id,
      input.workspace_id,
      input.document_id,
      input.original_query_log_id,
      input.question_text,
      JSON.stringify(input.topic_tags ?? []),
      input.wrong_answer_text,
      input.corrected_answer_text,
      input.note ?? null,
      input.submitted_by,
      input.supersedes_correction_id ?? null,
      input.scope,
      status,
      status === "active" ? (input.approved_by ?? input.submitted_by) : null,
      status === "active" ? new Date().toISOString() : null,
      input.suggested_correction_id ?? null,
    ]
  );
  return (await getCorrection(id))!;
}

export async function updateCorrectionText(
  id: string,
  fields: { question_text?: string; corrected_answer_text?: string; note?: string | null; topic_tags?: string[] }
): Promise<void> {
  const sets: string[] = ["updated_at = now()"];
  const params: unknown[] = [];
  const push = (col: string, val: unknown) => {
    sets.push(`${col} = $${params.length + 1}`);
    params.push(val);
  };
  if (fields.question_text !== undefined) push("question_text", fields.question_text);
  if (fields.corrected_answer_text !== undefined) push("corrected_answer_text", fields.corrected_answer_text);
  if (fields.note !== undefined) push("note", fields.note);
  if (fields.topic_tags !== undefined) push("topic_tags", JSON.stringify(fields.topic_tags));
  params.push(id);
  await pool().query(`UPDATE corrections SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
}

export async function setCorrectionStatus(
  id: string,
  status: CorrectionStatus,
  supersedesBy?: string,
  extra?: { approved_by?: string | null; rejection_reason?: string | null }
): Promise<void> {
  await pool().query(
    `UPDATE corrections SET status = $1,
      updated_at = now(),
      supersedes_correction_id = COALESCE($2, supersedes_correction_id),
      approved_by = COALESCE($3, approved_by),
      approved_at = CASE WHEN $4 = 'active' THEN now() ELSE approved_at END,
      rejection_reason = COALESCE($5, rejection_reason)
     WHERE id = $6`,
    [status, supersedesBy ?? null, extra?.approved_by ?? null, status, extra?.rejection_reason ?? null, id]
  );
}

export async function setNeedsVersionReview(id: string, flag: boolean): Promise<void> {
  await pool().query("UPDATE corrections SET needs_version_review = $1, updated_at = now() WHERE id = $2", [
    flag ? 1 : 0,
    id,
  ]);
}

export async function incrementCorrectionStats(id: string, field: "served_count" | "confirmed_count"): Promise<void> {
  const col = field === "served_count" ? "served_count" : "confirmed_count";
  await pool().query(`UPDATE corrections SET ${col} = ${col} + 1 WHERE id = $1`, [id]);
}

export async function updateCorrectionScope(id: string, scope: CorrectionScope, documentId: string | null): Promise<void> {
  await pool().query("UPDATE corrections SET scope = $1, document_id = $2, updated_at = now() WHERE id = $3", [
    scope,
    documentId,
    id,
  ]);
}

export async function getCorrection(id: string): Promise<CorrectionRow | undefined> {
  const r = await pool().query("SELECT * FROM corrections WHERE id = $1", [id]);
  return r.rows[0] as CorrectionRow | undefined;
}

export async function listCorrections(workspaceId: string, documentId?: string, includeNonLive = true): Promise<CorrectionRow[]> {
  const liveFilter = includeNonLive ? "" : "AND status IN ('active','pending')";
  if (documentId) {
    const r = await pool().query(
      `SELECT * FROM corrections WHERE workspace_id = $1 AND (document_id = $2 OR scope = 'workspace') ${liveFilter} ORDER BY created_at DESC`,
      [workspaceId, documentId]
    );
    return r.rows as CorrectionRow[];
  }
  const r = await pool().query(
    `SELECT * FROM corrections WHERE workspace_id = $1 ${liveFilter} ORDER BY created_at DESC`,
    [workspaceId]
  );
  return r.rows as CorrectionRow[];
}

export async function listPendingCorrections(workspaceId: string): Promise<CorrectionRow[]> {
  const r = await pool().query(
    "SELECT * FROM corrections WHERE workspace_id = $1 AND status = 'pending' ORDER BY created_at ASC",
    [workspaceId]
  );
  return r.rows as CorrectionRow[];
}

export async function listCorrectionsWithPendingEdits(workspaceId: string): Promise<CorrectionRow[]> {
  const r = await pool().query(
    "SELECT * FROM corrections WHERE workspace_id = $1 AND pending_edit IS NOT NULL AND status = 'active' ORDER BY pending_edit_at ASC",
    [workspaceId]
  );
  return r.rows as CorrectionRow[];
}

export interface PendingEditPayload {
  question_text?: string;
  corrected_answer_text?: string;
  note?: string | null;
  topic_tags?: string[];
  scope?: "document" | "workspace";
  document_id?: string | null;
}

export async function setPendingEdit(id: string, payload: PendingEditPayload | null, editorId: string | null): Promise<void> {
  await pool().query(
    `UPDATE corrections SET
      pending_edit = $1,
      pending_edit_by = $2,
      pending_edit_at = CASE WHEN $3 IS NULL THEN NULL ELSE now() END,
      updated_at = now()
     WHERE id = $4`,
    [payload === null ? null : JSON.stringify(payload), editorId, payload === null ? null : editorId, id]
  );
}

export async function listActiveCorrectionsForDocs(workspaceId: string, documentIds: string[]): Promise<CorrectionRow[]> {
  const r = await pool().query(
    `SELECT * FROM corrections
     WHERE workspace_id = $1 AND status = 'active' AND (scope = 'workspace' OR document_id = ANY($2::text[]))`,
    [workspaceId, documentIds.length ? documentIds : null]
  );
  return r.rows as CorrectionRow[];
}

export async function deleteCorrectionsForDocument(documentId: string): Promise<void> {
  await pool().query("DELETE FROM corrections WHERE document_id = $1", [documentId]);
}

export async function listCorrectionsNeedingVersionReview(workspaceId: string): Promise<CorrectionRow[]> {
  const r = await pool().query(
    "SELECT * FROM corrections WHERE workspace_id = $1 AND needs_version_review = 1 ORDER BY created_at DESC",
    [workspaceId]
  );
  return r.rows as CorrectionRow[];
}

/* ------------------------- Comments ------------------------- */

export async function insertComment(correctionId: string, authorId: string, body: string): Promise<CorrectionCommentRow> {
  const id = "cm_" + randomUUID();
  await pool().query("INSERT INTO correction_comments (id, correction_id, author_id, body) VALUES ($1, $2, $3, $4)", [
    id,
    correctionId,
    authorId,
    body,
  ]);
  return (await getComment(id))!;
}

export async function getComment(id: string): Promise<CorrectionCommentRow | undefined> {
  const r = await pool().query("SELECT * FROM correction_comments WHERE id = $1", [id]);
  return r.rows[0] as CorrectionCommentRow | undefined;
}

export async function listComments(correctionId: string): Promise<CorrectionCommentRow[]> {
  const r = await pool().query("SELECT * FROM correction_comments WHERE correction_id = $1 ORDER BY created_at ASC", [
    correctionId,
  ]);
  return r.rows as CorrectionCommentRow[];
}

export async function deleteCommentsForCorrections(correctionIds: string[]): Promise<void> {
  if (!correctionIds.length) return;
  await pool().query(`DELETE FROM correction_comments WHERE correction_id = ANY($1::text[])`, [correctionIds]);
}

/* ------------------------- Audit log (append-only) ------------------------- */

export interface NewAuditEntry {
  workspace_id: string;
  actor_id: string;
  action_type: AuditActionType;
  target_type: string;
  target_id: string;
  before_state?: unknown;
  after_state?: unknown;
}

export async function appendAudit(entry: NewAuditEntry): Promise<AuditLogEntryRow> {
  const id = "aud_" + randomUUID();
  await pool().query(
    `INSERT INTO audit_log (id, workspace_id, actor_id, action_type, target_type, target_id, before_state, after_state)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      entry.workspace_id,
      entry.actor_id,
      entry.action_type,
      entry.target_type,
      entry.target_id,
      entry.before_state === undefined ? null : JSON.stringify(entry.before_state),
      entry.after_state === undefined ? null : JSON.stringify(entry.after_state),
    ]
  );
  return (await getAuditEntry(id))!;
}

export async function getAuditEntry(id: string): Promise<AuditLogEntryRow | undefined> {
  const r = await pool().query("SELECT * FROM audit_log WHERE id = $1", [id]);
  return r.rows[0] as AuditLogEntryRow | undefined;
}

export async function listAuditEntries(workspaceId: string, limit = 1000, offset = 0): Promise<AuditLogEntryRow[]> {
  const r = await pool().query("SELECT * FROM audit_log WHERE workspace_id = $1 ORDER BY timestamp DESC LIMIT $2 OFFSET $3", [
    workspaceId,
    Math.min(limit, 5000),
    offset,
  ]);
  return r.rows as AuditLogEntryRow[];
}

/* ------------------------- Conflict alerts ------------------------- */

export interface NewConflictAlert {
  workspace_id: string;
  document_a_id: string;
  passage_a_ref: string;
  passage_a_text: string;
  document_b_id: string;
  passage_b_ref: string;
  passage_b_text: string;
  similarity: number;
  rationale?: string | null;
}

export async function insertConflictAlert(a: NewConflictAlert): Promise<ConflictAlertRow> {
  const id = "cfl_" + randomUUID();
  await pool().query(
    `INSERT INTO conflict_alerts (id, workspace_id, document_a_id, passage_a_ref, passage_a_text, document_b_id, passage_b_ref, passage_b_text, similarity, rationale)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      id,
      a.workspace_id,
      a.document_a_id,
      a.passage_a_ref,
      a.passage_a_text,
      a.document_b_id,
      a.passage_b_ref,
      a.passage_b_text,
      a.similarity,
      a.rationale ?? null,
    ]
  );
  return (await getConflictAlert(id))!;
}

export async function getConflictAlert(id: string): Promise<ConflictAlertRow | undefined> {
  const r = await pool().query("SELECT * FROM conflict_alerts WHERE id = $1", [id]);
  return r.rows[0] as ConflictAlertRow | undefined;
}

export async function listConflictAlerts(workspaceId: string, status?: "open" | "resolved" | "dismissed"): Promise<ConflictAlertRow[]> {
  if (status) {
    const r = await pool().query(
      "SELECT * FROM conflict_alerts WHERE workspace_id = $1 AND status = $2 ORDER BY detected_at DESC",
      [workspaceId, status]
    );
    return r.rows as ConflictAlertRow[];
  }
  const r = await pool().query("SELECT * FROM conflict_alerts WHERE workspace_id = $1 ORDER BY detected_at DESC LIMIT 200", [
    workspaceId,
  ]);
  return r.rows as ConflictAlertRow[];
}

export async function findExistingConflict(workspaceId: string, refA: string, refB: string): Promise<boolean> {
  const r = await pool().query(
    `SELECT id FROM conflict_alerts WHERE workspace_id = $1 AND status = 'open' AND
     ((passage_a_ref = $2 AND passage_b_ref = $3) OR (passage_a_ref = $4 AND passage_b_ref = $5)) LIMIT 1`,
    [workspaceId, refA, refB, refB, refA]
  );
  return Boolean(r.rows[0]);
}

export async function setConflictStatus(id: string, status: "open" | "resolved" | "dismissed"): Promise<void> {
  await pool().query("UPDATE conflict_alerts SET status = $1 WHERE id = $2", [status, id]);
}

/* ------------------------- Integrations ------------------------- */

export interface UpsertConnectionInput {
  workspace_id: string;
  provider: IntegrationConnectionRow["provider"];
  display_name?: string;
  auth_credentials_encrypted?: string | null;
  sync_status?: IntegrationConnectionRow["sync_status"];
}

export async function upsertIntegrationConnection(c: UpsertConnectionInput): Promise<IntegrationConnectionRow> {
  await pool().query(
    `INSERT INTO integration_connections (id, workspace_id, provider, display_name, auth_credentials, sync_status)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (workspace_id, provider) DO UPDATE SET
       display_name = excluded.display_name,
       auth_credentials = COALESCE(excluded.auth_credentials, auth_credentials),
       sync_status = excluded.sync_status`,
    ["icn_" + randomUUID(), c.workspace_id, c.provider, c.display_name ?? "", c.auth_credentials_encrypted ?? null, c.sync_status ?? "connected"]
  );
  return (await getIntegrationConnection(c.workspace_id, c.provider))!;
}

export async function getIntegrationConnection(workspaceId: string, provider: string): Promise<IntegrationConnectionRow | undefined> {
  const r = await pool().query("SELECT * FROM integration_connections WHERE workspace_id = $1 AND provider = $2", [
    workspaceId,
    provider,
  ]);
  return r.rows[0] as IntegrationConnectionRow | undefined;
}

export async function listIntegrationConnections(workspaceId: string): Promise<IntegrationConnectionRow[]> {
  const r = await pool().query("SELECT * FROM integration_connections WHERE workspace_id = $1 ORDER BY created_at ASC", [
    workspaceId,
  ]);
  return r.rows as IntegrationConnectionRow[];
}

export async function deleteIntegrationConnection(workspaceId: string, provider: string): Promise<void> {
  await pool().query("DELETE FROM integration_connections WHERE workspace_id = $1 AND provider = $2", [workspaceId, provider]);
}

/* ------------------------- API keys ------------------------- */

export interface NewApiKeyInput {
  workspace_id: string;
  key_hash: string;
  key_prefix: string;
  scopes: string[];
  created_by: string;
  name?: string;
}

export async function insertApiKey(k: NewApiKeyInput): Promise<ApiKeyRow> {
  const id = "key_" + randomUUID();
  await pool().query(
    `INSERT INTO api_keys (id, workspace_id, key_hash, key_prefix, scopes, created_by, name)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, k.workspace_id, k.key_hash, k.key_prefix, JSON.stringify(k.scopes), k.created_by, k.name ?? ""]
  );
  return (await getApiKey(id))!;
}

export async function getApiKey(id: string): Promise<ApiKeyRow | undefined> {
  const r = await pool().query("SELECT * FROM api_keys WHERE id = $1", [id]);
  return r.rows[0] as ApiKeyRow | undefined;
}

export async function findApiKeyByHash(keyHash: string): Promise<ApiKeyRow | undefined> {
  const r = await pool().query("SELECT * FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL", [keyHash]);
  return r.rows[0] as ApiKeyRow | undefined;
}

export async function listApiKeys(workspaceId: string): Promise<ApiKeyRow[]> {
  const r = await pool().query("SELECT * FROM api_keys WHERE workspace_id = $1 ORDER BY created_at DESC", [workspaceId]);
  return r.rows as ApiKeyRow[];
}

export async function revokeApiKey(id: string): Promise<void> {
  await pool().query("UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL", [id]);
}

/* ------------------------- Suggested corrections ------------------------- */

export interface NewSuggestedCorrection {
  workspace_id: string;
  source_pattern: unknown;
  canonical_question: string;
  suggested_text: string;
  rationale?: string | null;
}

export async function insertSuggestedCorrection(s: NewSuggestedCorrection): Promise<SuggestedCorrectionRow> {
  const id = "sug_" + randomUUID();
  await pool().query(
    `INSERT INTO suggested_corrections (id, workspace_id, source_pattern, canonical_question, suggested_text, rationale)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, s.workspace_id, JSON.stringify(s.source_pattern), s.canonical_question, s.suggested_text, s.rationale ?? null]
  );
  return (await getSuggestedCorrection(id))!;
}

export async function getSuggestedCorrection(id: string): Promise<SuggestedCorrectionRow | undefined> {
  const r = await pool().query("SELECT * FROM suggested_corrections WHERE id = $1", [id]);
  return r.rows[0] as SuggestedCorrectionRow | undefined;
}

export async function listSuggestedCorrections(workspaceId: string, status?: "pending" | "accepted" | "dismissed"): Promise<SuggestedCorrectionRow[]> {
  if (status) {
    const r = await pool().query(
      "SELECT * FROM suggested_corrections WHERE workspace_id = $1 AND status = $2 ORDER BY generated_at DESC LIMIT 100",
      [workspaceId, status]
    );
    return r.rows as SuggestedCorrectionRow[];
  }
  const r = await pool().query(
    "SELECT * FROM suggested_corrections WHERE workspace_id = $1 ORDER BY generated_at DESC LIMIT 100",
    [workspaceId]
  );
  return r.rows as SuggestedCorrectionRow[];
}

export async function setSuggestedCorrectionStatus(id: string, status: "pending" | "accepted" | "dismissed"): Promise<void> {
  await pool().query("UPDATE suggested_corrections SET status = $1 WHERE id = $2", [status, id]);
}

export async function findSimilarPendingSuggestion(workspaceId: string, canonicalQuestion: string): Promise<SuggestedCorrectionRow | undefined> {
  const r = await pool().query(
    "SELECT * FROM suggested_corrections WHERE workspace_id = $1 AND status = 'pending' AND REPLACE(LOWER(TRIM(canonical_question)), ' ', '') = $2 LIMIT 1",
    [workspaceId, canonicalQuestion.toLowerCase().replace(/\s+/g, "")]
  );
  return r.rows[0] as SuggestedCorrectionRow | undefined;
}

/* ------------------------- Webhooks ------------------------- */

export interface NewWebhookEndpoint {
  workspace_id: string;
  url: string;
  secret: string;
  events: string[];
  active?: boolean;
}

export async function insertWebhookEndpoint(w: NewWebhookEndpoint): Promise<WebhookEndpointRow> {
  const id = "whk_" + randomUUID();
  await pool().query(
    `INSERT INTO webhook_endpoints (id, workspace_id, url, secret, events, active) VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, w.workspace_id, w.url, w.secret, JSON.stringify(w.events), w.active === false ? 0 : 1]
  );
  return (await getWebhookEndpoint(id))!;
}

export async function getWebhookEndpoint(id: string): Promise<WebhookEndpointRow | undefined> {
  const r = await pool().query("SELECT * FROM webhook_endpoints WHERE id = $1", [id]);
  return r.rows[0] as WebhookEndpointRow | undefined;
}

export async function listWebhookEndpoints(workspaceId: string): Promise<WebhookEndpointRow[]> {
  const r = await pool().query("SELECT * FROM webhook_endpoints WHERE workspace_id = $1 ORDER BY created_at ASC", [
    workspaceId,
  ]);
  return r.rows as WebhookEndpointRow[];
}

export async function deleteWebhookEndpoint(id: string): Promise<void> {
  await pool().query("DELETE FROM webhook_endpoints WHERE id = $1", [id]);
}

/* ------------------------- Chat sessions & messages ------------------------- */

export interface NewChatSessionInput {
  id?: string;
  user_id: string;
  workspace_id: string;
  title?: string;
  document_ids?: string[];
  status?: ChatSessionRow["status"];
}

export async function insertChatSession(input: NewChatSessionInput): Promise<ChatSessionRow> {
  const id = input.id ?? "chat_" + randomUUID();
  await pool().query(
    `INSERT INTO chat_sessions (id, user_id, workspace_id, title, document_ids, status)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, input.user_id, input.workspace_id, input.title ?? "New chat", JSON.stringify(input.document_ids ?? []), input.status ?? "active"]
  );
  return (await getChatSession(id))!;
}

export async function getChatSession(id: string): Promise<ChatSessionRow | undefined> {
  const r = await pool().query("SELECT * FROM chat_sessions WHERE id = $1", [id]);
  return r.rows[0] as ChatSessionRow | undefined;
}

export async function listChatSessions(userId: string, workspaceId: string): Promise<ChatSessionRow[]> {
  const r = await pool().query(
    `SELECT * FROM chat_sessions
     WHERE user_id = $1 AND workspace_id = $2 AND status = 'active'
     ORDER BY last_message_at IS NULL, last_message_at DESC, created_at DESC
     LIMIT 200`,
    [userId, workspaceId]
  );
  return r.rows as ChatSessionRow[];
}

export async function touchChatSession(id: string, documentIds: string[]): Promise<void> {
  await pool().query(
    `UPDATE chat_sessions SET
       updated_at = now(),
       last_message_at = now(),
       document_ids = $1
     WHERE id = $2`,
    [JSON.stringify(documentIds), id]
  );
}

export async function renameChatSession(id: string, title: string): Promise<void> {
  await pool().query("UPDATE chat_sessions SET title = $1, updated_at = now() WHERE id = $2", [title, id]);
}

export interface NewChatMessageInput {
  id?: string;
  session_id: string;
  role: ChatMessageRole;
  content: unknown;
  query_log_id?: string | null;
}

export async function insertChatMessage(input: NewChatMessageInput): Promise<ChatMessageRow> {
  const id = input.id ?? "msg_" + randomUUID();
  await pool().query(
    `INSERT INTO chat_messages (id, session_id, role, content, query_log_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, input.session_id, input.role, JSON.stringify(input.content), input.query_log_id ?? null]
  );
  return (await getChatMessage(id))!;
}

export async function getChatMessage(id: string): Promise<ChatMessageRow | undefined> {
  const r = await pool().query("SELECT * FROM chat_messages WHERE id = $1", [id]);
  return r.rows[0] as ChatMessageRow | undefined;
}

export async function listChatMessages(sessionId: string): Promise<ChatMessageRow[]> {
  const r = await pool().query("SELECT * FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC, id ASC", [
    sessionId,
  ]);
  return r.rows as ChatMessageRow[];
}

export async function archiveChatSession(id: string): Promise<void> {
  await pool().query("UPDATE chat_sessions SET status = 'archived', updated_at = now() WHERE id = $1", [id]);
}

export async function deleteChatSession(id: string): Promise<void> {
  await withTx(async (c) => {
    await c.query("DELETE FROM chat_messages WHERE session_id = $1", [id]);
    await c.query("DELETE FROM chat_sessions WHERE id = $1", [id]);
  });
}

export async function deleteChatSessionsForWorkspace(workspaceId: string): Promise<void> {
  await withTx(async (c) => {
    const res = await c.query("SELECT id FROM chat_sessions WHERE workspace_id = $1", [workspaceId]);
    const ids = (res.rows as Array<{ id: string }>).map((r) => r.id);
    if (ids.length) {
      const p = ph(ids.length);
      await c.query(`DELETE FROM chat_messages WHERE session_id IN (${p})`, ids);
      await c.query(`DELETE FROM chat_sessions WHERE id IN (${p})`, ids);
    }
  });
}
