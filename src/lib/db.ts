import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type {
  Citation,
  CorrectionRow,
  CorrectionScope,
  CorrectionStatus,
  DocumentRow,
  DocumentStatus,
  FeedbackStatus,
  QueryLogRow,
  SourceType,
} from "./types";
import { sqlitePath } from "./config";

declare global {
  // eslint-disable-next-line no-var
  var __crispDb: Database.Database | undefined;
}

function createDb(): Database.Database {
  mkdirSync(require_path_dirname(sqlitePath()), { recursive: true });
  const db = new Database(sqlitePath());
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      member_ids TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      page_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'processing',
      file_hash TEXT NOT NULL,
      ocr_warning INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS query_logs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      document_ids TEXT NOT NULL,
      question_text TEXT NOT NULL,
      answer_text TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'document',
      citations TEXT NOT NULL DEFAULT '[]',
      correction_id TEXT,
      feedback_status TEXT NOT NULL DEFAULT 'none',
      retry_of TEXT,
      attempt INTEGER NOT NULL DEFAULT 0,
      strategy_note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_qlog_docs ON query_logs(workspace_id);
    CREATE TABLE IF NOT EXISTS corrections (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      document_id TEXT,
      original_query_log_id TEXT NOT NULL,
      question_text TEXT NOT NULL,
      topic_tags TEXT NOT NULL DEFAULT '[]',
      wrong_answer_text TEXT NOT NULL,
      corrected_answer_text TEXT NOT NULL,
      note TEXT,
      submitted_by TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      supersedes_correction_id TEXT,
      scope TEXT NOT NULL DEFAULT 'document',
      served_count INTEGER NOT NULL DEFAULT 0,
      confirmed_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `);
  seed(db);
  return db;
}

// tiny helper to avoid importing node:path twice under different names
import { dirname as _dirname } from "node:path";
function require_path_dirname(p: string): string {
  return _dirname(p);
}

function seed(db: Database.Database) {
  const user = db.prepare("SELECT id FROM users LIMIT 1").get();
  if (!user) {
    const uid = "user_local_" + randomUUID().slice(0, 8);
    db.prepare("INSERT INTO users (id, name, email) VALUES (?, ?, ?)").run(uid, "Local User", "local@crispai.app");
  }
  const ws = db.prepare("SELECT id FROM workspaces LIMIT 1").get();
  if (!ws) {
    const uid = (db.prepare("SELECT id FROM users LIMIT 1").get() as { id: string }).id;
    db.prepare("INSERT INTO workspaces (id, name, member_ids) VALUES (?, ?, ?)").run(
      "ws_default",
      "Personal Workspace",
      JSON.stringify([uid])
    );
  }
}

export function getDb(): Database.Database {
  globalThis.__crispDb ??= createDb();
  return globalThis.__crispDb;
}

export const defaultWorkspaceId = () => "ws_default";
export const defaultUserId = () => (getDb().prepare("SELECT id FROM users LIMIT 1").get() as { id: string }).id;

/* ---------------- Documents ---------------- */

export type NewDocumentInput = Omit<DocumentRow, "created_at" | "ocr_warning"> & {
  ocr_warning?: boolean | number;
};

export function insertDocument(doc: NewDocumentInput) {
  getDb()
    .prepare(
      `INSERT INTO documents (id, workspace_id, owner_id, filename, storage_path, page_count, status, file_hash, ocr_warning, error)
       VALUES (@id, @workspace_id, @owner_id, @filename, @storage_path, @page_count, @status, @file_hash, @ocr_warning, @error)`
    )
    .run({ ...doc, page_count: doc.page_count ?? 0, ocr_warning: doc.ocr_warning ? 1 : 0, error: doc.error ?? null });
}

export function updateDocumentStatus(
  id: string,
  patch: Partial<Pick<DocumentRow, "status" | "page_count" | "error">> & { ocr_warning?: boolean }
) {
  const sets: string[] = [];
  const params: Record<string, unknown> = { id };
  if (patch.status !== undefined) { sets.push("status = @status"); params.status = patch.status; }
  if (patch.page_count !== undefined) { sets.push("page_count = @page_count"); params.page_count = patch.page_count; }
  if (patch.ocr_warning !== undefined) { sets.push("ocr_warning = @ocr_warning"); params.ocr_warning = patch.ocr_warning ? 1 : 0; }
  if (patch.error !== undefined) { sets.push("error = @error"); params.error = patch.error; }
  if (!sets.length) return;
  getDb().prepare(`UPDATE documents SET ${sets.join(", ")} WHERE id = @id`).run(params);
}

export function getDocument(id: string): DocumentRow | undefined {
  return getDb().prepare("SELECT * FROM documents WHERE id = ?").get(id) as DocumentRow | undefined;
}

export function listDocuments(workspaceId: string): DocumentRow[] {
  return getDb()
    .prepare("SELECT * FROM documents WHERE workspace_id = ? ORDER BY created_at DESC")
    .all(workspaceId) as DocumentRow[];
}

export function findDocumentByHash(hash: string): DocumentRow | undefined {
  return getDb().prepare("SELECT * FROM documents WHERE file_hash = ? AND status != 'failed' ORDER BY created_at DESC LIMIT 1").get(hash) as
    | DocumentRow
    | undefined;
}

export function deleteDocument(id: string) {
  getDb().prepare("DELETE FROM documents WHERE id = ?").run(id);
}

/* ---------------- Query logs ---------------- */

const parseQl = (row: QueryLogRow & { document_ids: string; citations: string }): QueryLogRow => row;

export interface NewQueryLogInput extends Omit<QueryLogRow, "created_at" | "document_ids" | "citations" | "correction_id"> {
  document_ids: string[];
  citations?: Citation[];
  correction_id?: string | null;
}

export function insertQueryLog(ql: NewQueryLogInput) {
  getDb()
    .prepare(
      `INSERT INTO query_logs (id, workspace_id, user_id, document_ids, question_text, answer_text, source_type, citations, correction_id, feedback_status, retry_of, attempt, strategy_note)
       VALUES (@id, @workspace_id, @user_id, @document_ids, @question_text, @answer_text, @source_type, @citations, @correction_id, @feedback_status, @retry_of, @attempt, @strategy_note)`
    )
    .run({
      ...ql,
      document_ids: JSON.stringify(ql.document_ids),
      citations: JSON.stringify(ql.citations ?? []),
      correction_id: ql.correction_id ?? null,
      feedback_status: ql.feedback_status ?? "none",
      retry_of: ql.retry_of ?? null,
    });
}

export function getQueryLog(id: string): QueryLogRow | undefined {
  const row = getDb().prepare("SELECT * FROM query_logs WHERE id = ?").get(id) as QueryLogRow | undefined;
  return row ? parseQl(row) : undefined;
}

export function setFeedbackStatus(id: string, status: FeedbackStatus) {
  getDb().prepare("UPDATE query_logs SET feedback_status = ? WHERE id = ?").run(status, id);
}

export function countRetryChain(queryLogId: string): number {
  let current = getQueryLog(queryLogId);
  let depth = 0;
  while (current?.retry_of && depth < 10) {
    current = getQueryLog(current.retry_of);
    depth++;
  }
  return current ? current.attempt : 0;
}

/** Cache lookup: identical normalized question over same docs, newer than any correction change for those docs/workspace. */
export function findCachedAnswer(workspaceId: string, normalizedQuestion: string, documentIds: string[]): QueryLogRow | undefined {
  const placeholders = documentIds.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT * FROM query_logs
       WHERE workspace_id = ?
         AND REPLACE(LOWER(TRIM(question_text)), ' ', '') = ?
         AND source_type IN ('document', 'correction')
         AND feedback_status = 'none'
       ORDER BY created_at DESC LIMIT 5`
    )
    .all(workspaceId, normalizedQuestion.replace(/\s+/g, "")) as QueryLogRow[];
  for (const r of rows) {
    try {
      const ids: string[] = JSON.parse(r.document_ids);
      if (!documentIds.some((d) => ids.includes(d))) continue;
    } catch { /* ignore malformed */ }
    const latestCorrectionAt = getDb()
      .prepare(
        `SELECT MAX(updated_at) AS ts FROM corrections
         WHERE workspace_id = ? AND status IN ('active', 'superseded') AND (scope = 'workspace' OR document_id IN (${placeholders || "''"}))`
      )
      .get(workspaceId, ...documentIds) as { ts: string | null };
    if (!latestCorrectionAt?.ts || latestCorrectionAt.ts <= r.created_at) return parseQl(r);
  }
  // No fallback on purpose: a cached log whose documents no longer intersect the
  // request (e.g. document deleted, or stale beyond a correction change) must not be served.
}

/* ---------------- Corrections ---------------- */

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
}

export function insertCorrection(input: NewCorrectionInput): CorrectionRow {
  const id = input.id ?? "corr_" + randomUUID();
  getDb()
    .prepare(
      `INSERT INTO corrections (id, workspace_id, document_id, original_query_log_id, question_text, topic_tags, wrong_answer_text, corrected_answer_text, note, submitted_by, supersedes_correction_id, scope)
       VALUES (@id, @workspace_id, @document_id, @original_query_log_id, @question_text, @topic_tags, @wrong_answer_text, @corrected_answer_text, @note, @submitted_by, @supersedes_correction_id, @scope)`
    )
    .run({
      ...input,
      id,
      topic_tags: JSON.stringify(input.topic_tags ?? []),
      note: input.note ?? null,
      supersedes_correction_id: input.supersedes_correction_id ?? null,
    });
  return getCorrection(id)!;
}

export function updateCorrectionText(id: string, fields: { question_text?: string; corrected_answer_text?: string; note?: string | null; topic_tags?: string[] }) {
  const sets: string[] = ["updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')"];
  const params: Record<string, unknown> = { id };
  if (fields.question_text !== undefined) { sets.push("question_text = @question_text"); params.question_text = fields.question_text; }
  if (fields.corrected_answer_text !== undefined) { sets.push("corrected_answer_text = @corrected_answer_text"); params.corrected_answer_text = fields.corrected_answer_text; }
  if (fields.note !== undefined) { sets.push("note = @note"); params.note = fields.note; }
  if (fields.topic_tags !== undefined) { sets.push("topic_tags = @topic_tags"); params.topic_tags = JSON.stringify(fields.topic_tags); }
  getDb().prepare(`UPDATE corrections SET ${sets.join(", ")} WHERE id = @id`).run(params);
}

export function setCorrectionStatus(id: string, status: CorrectionStatus, supersedesBy?: string) {
  getDb()
    .prepare(
      `UPDATE corrections SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
       supersedes_correction_id = COALESCE(?, supersedes_correction_id) WHERE id = ?`
    )
    .run(status, supersedesBy ?? null, id);
}

export function incrementCorrectionStats(id: string, field: "served_count" | "confirmed_count") {
  const col = field === "served_count" ? "served_count" : "confirmed_count";
  getDb().prepare(`UPDATE corrections SET ${col} = ${col} + 1 WHERE id = ?`).run(id);
}

export function updateCorrectionScope(id: string, scope: CorrectionScope, documentId: string | null) {
  getDb()
    .prepare("UPDATE corrections SET scope = ?, document_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
    .run(scope, documentId, id);
}

export function getCorrection(id: string): CorrectionRow | undefined {
  return getDb().prepare("SELECT * FROM corrections WHERE id = ?").get(id) as CorrectionRow | undefined;
}

export function listCorrections(workspaceId: string, documentId?: string): CorrectionRow[] {
  if (documentId) {
    return getDb()
      .prepare("SELECT * FROM corrections WHERE workspace_id = ? AND (document_id = ? OR scope = 'workspace') ORDER BY created_at DESC")
      .all(workspaceId, documentId) as CorrectionRow[];
  }
  return getDb()
    .prepare("SELECT * FROM corrections WHERE workspace_id = ? ORDER BY created_at DESC")
    .all(workspaceId) as CorrectionRow[];
}

export function listActiveCorrectionsForDocs(workspaceId: string, documentIds: string[]): CorrectionRow[] {
  const placeholders = documentIds.map(() => "?").join(",");
  return getDb()
    .prepare(
      `SELECT * FROM corrections
       WHERE workspace_id = ? AND status = 'active' AND (scope = 'workspace' OR document_id IN (${placeholders || "''"}))`
    )
    .all(workspaceId, ...documentIds) as CorrectionRow[];
}

export function deleteCorrectionsForDocument(documentId: string) {
  getDb().prepare("DELETE FROM corrections WHERE document_id = ?").run(documentId);
}
