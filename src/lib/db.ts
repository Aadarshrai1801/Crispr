import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type {
  ApiKeyRow,
  AuditActionType,
  AuditLogEntryRow,
  Citation,
  ConflictAlertRow,
  CorrectionCommentRow,
  CorrectionRow,
  CorrectionScope,
  CorrectionStatus,
  DocumentRow,
  DocumentSourceType,
  DocumentStatus,
  DocumentVersionRow,
  FeedbackStatus,
  IntegrationConnectionRow,
  PlanTier,
  QueryLogRow,
  SourceType,
  SuggestedCorrectionRow,
  UserRow,
  WebhookEndpointRow,
  WorkspaceMembershipRow,
  WorkspaceRole,
  WorkspaceRow,
} from "./types";
import { sqlitePath } from "./config";

declare global {
  // eslint-disable-next-line no-var
  var __crispDb: Database.Database | undefined;
}

/* ------------------------- migrations ------------------------- */

function tableColumns(db: Database.Database, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

function ensureColumn(db: Database.Database, table: string, column: string, ddl: string) {
  const cols = tableColumns(db, table);
  if (!cols.has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

function migrate(db: Database.Database) {
  // --- v2 columns on v1 tables ---
  ensureColumn(db, "workspaces", "owner_id", "TEXT");
  ensureColumn(db, "workspaces", "approval_required", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "workspaces", "confidence_threshold", "REAL NOT NULL DEFAULT 0.55");
  ensureColumn(db, "workspaces", "plan_tier", "TEXT NOT NULL DEFAULT 'team'");
  ensureColumn(db, "documents", "source_type", "TEXT NOT NULL DEFAULT 'upload'");
  ensureColumn(db, "documents", "source_connection_id", "TEXT");
  ensureColumn(db, "documents", "current_version_id", "TEXT");
  ensureColumn(db, "documents", "version_number", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "query_logs", "confidence_score", "REAL");
  ensureColumn(db, "query_logs", "confidence_threshold", "REAL");
  ensureColumn(db, "query_logs", "flagged_needs_review", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "corrections", "approved_by", "TEXT");
  ensureColumn(db, "corrections", "approved_at", "TEXT");
  ensureColumn(db, "corrections", "rejection_reason", "TEXT");
  ensureColumn(db, "corrections", "needs_version_review", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "corrections", "suggested_correction_id", "TEXT");

  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_members (
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'Viewer',
      joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (workspace_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS document_versions (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      uploaded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      uploaded_by TEXT NOT NULL,
      diff_summary TEXT,
      storage_path TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      page_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_docver_doc ON document_versions(document_id);
    CREATE TABLE IF NOT EXISTS correction_comments (
      id TEXT PRIMARY KEY,
      correction_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_comments_corr ON correction_comments(correction_id);
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      before_state TEXT,
      after_state TEXT,
      timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_audit_ws ON audit_log(workspace_id, timestamp);
    CREATE TABLE IF NOT EXISTS conflict_alerts (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      document_a_id TEXT NOT NULL,
      passage_a_ref TEXT NOT NULL,
      passage_a_text TEXT NOT NULL DEFAULT '',
      document_b_id TEXT NOT NULL,
      passage_b_ref TEXT NOT NULL,
      passage_b_text TEXT NOT NULL DEFAULT '',
      similarity REAL NOT NULL DEFAULT 0,
      rationale TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      detected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_conflicts_ws ON conflict_alerts(workspace_id, status);
    CREATE TABLE IF NOT EXISTS integration_connections (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      auth_credentials TEXT,
      sync_status TEXT NOT NULL DEFAULT 'disconnected',
      last_synced_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE (workspace_id, provider)
    );
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      scopes TEXT NOT NULL DEFAULT '[]',
      created_by TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      revoked_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS suggested_corrections (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      source_pattern TEXT NOT NULL,
      canonical_question TEXT NOT NULL,
      suggested_text TEXT NOT NULL DEFAULT '',
      rationale TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      generated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_suggestions_ws ON suggested_corrections(workspace_id, status);
    CREATE TABLE IF NOT EXISTS webhook_endpoints (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      url TEXT NOT NULL,
      secret TEXT NOT NULL,
      events TEXT NOT NULL DEFAULT '[]',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_documents_ws ON documents(workspace_id);
  `);
}

/* ------------------------- setup ------------------------- */

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
  migrate(db);
  seed(db);
  return db;
}

// tiny helper to avoid importing node:path twice under different names
import { dirname as _dirname } from "node:path";
function require_path_dirname(p: string): string {
  return _dirname(p);
}

const DEMO_USERS: Array<{ id: string; name: string; email: string }> = [
  { id: "user_marcus", name: "Marcus (Team Lead)", email: "marcus@crispai.app" },
  { id: "user_priya", name: "Priya (Analyst)", email: "priya@crispai.app" },
  { id: "user_dana", name: "Dana (Admin)", email: "dana@crispai.app" },
];

function seed(db: Database.Database) {
  const user = db.prepare("SELECT id FROM users LIMIT 1").get();
  let ownerId: string;
  if (!user) {
    ownerId = "user_local_" + randomUUID().slice(0, 8);
    db.prepare("INSERT INTO users (id, name, email) VALUES (?, ?, ?)").run(ownerId, "Local User", "local@crispai.app");
  } else {
    ownerId = (user as { id: string }).id;
  }
  for (const du of DEMO_USERS) {
    db.prepare("INSERT OR IGNORE INTO users (id, name, email) VALUES (?, ?, ?)").run(du.id, du.name, du.email);
  }

  let wsId = "ws_default";
  const ws = db.prepare("SELECT id FROM workspaces LIMIT 1").get();
  if (!ws) {
    db.prepare(
      "INSERT INTO workspaces (id, name, member_ids, owner_id, approval_required, confidence_threshold, plan_tier) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(wsId, "Personal Workspace", JSON.stringify([ownerId]), ownerId, 0, 0.55, "team");
  } else {
    wsId = (ws as { id: string }).id;
    // Backfill owner on pre-v2 workspaces.
    db.prepare("UPDATE workspaces SET owner_id = ? WHERE id = ? AND (owner_id IS NULL OR owner_id = '')").run(ownerId, wsId);
  }

  // Ensure every legacy member_ids entry has a membership row; owner is always Admin.
  const wss = db.prepare("SELECT id, owner_id, member_ids FROM workspaces").all() as Array<{
    id: string;
    owner_id: string | null;
    member_ids: string;
  }>;
  const insertMember = db.prepare(
    "INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)"
  );
  for (const w of wss) {
    if (w.owner_id) insertMember.run(w.id, w.owner_id, "Admin");
    try {
      const ids = JSON.parse(w.member_ids || "[]") as string[];
      for (const uid of ids) insertMember.run(w.id, uid, "Contributor");
    } catch {
      /* ignore malformed */
    }
  }

  // Default workspace behaves exactly like v1 (no approval gate), but is Team-tier so
  // collaboration features are demonstrable without breaking anything.
  db.prepare("INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'Admin')").run(
    wsId,
    ownerId
  );

  // Seed demo teammates in the default workspace with distinct roles so the RBAC
  // matrix (FR-34) is observable via the user switcher. The owner is always Admin.
  const demoRoles: Array<[string, WorkspaceRole]> = [
    ["user_marcus", "Approver"],
    ["user_priya", "Contributor"],
    ["user_dana", "Viewer"],
  ];
  for (const [uid, role] of demoRoles) {
    if (uid !== ownerId) {
      db.prepare("INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)").run(
        wsId,
        uid,
        role
      );
    }
  }
}

export function getDb(): Database.Database {
  globalThis.__crispDb ??= createDb();
  return globalThis.__crispDb;
}

export const defaultWorkspaceId = () => "ws_default";
export const defaultUserId = () =>
  (getDb().prepare("SELECT id FROM users ORDER BY rowid LIMIT 1").get() as { id: string }).id;

/* ------------------------- Users ------------------------- */

export function listUsers(): UserRow[] {
  return getDb().prepare("SELECT * FROM users ORDER BY rowid").all() as UserRow[];
}

export function getUser(id: string): UserRow | undefined {
  return getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
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

export function insertWorkspace(input: NewWorkspaceInput): WorkspaceRow {
  const id = input.id ?? "ws_" + randomUUID();
  getDb()
    .prepare(
      `INSERT INTO workspaces (id, name, owner_id, member_ids, approval_required, confidence_threshold, plan_tier)
       VALUES (@id, @name, @owner_id, '[]', @approval_required, @confidence_threshold, @plan_tier)`
    )
    .run({
      id,
      name: input.name,
      owner_id: input.owner_id,
      approval_required: input.approval_required ? 1 : 0,
      confidence_threshold: input.confidence_threshold ?? 0.55,
      plan_tier: input.plan_tier ?? "team",
    });
  getDb()
    .prepare("INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'Admin')")
    .run(id, input.owner_id);
  return getWorkspace(id)!;
}

export function updateWorkspaceSettings(
  id: string,
  patch: Partial<Pick<WorkspaceRow, "name" | "confidence_threshold" | "plan_tier">> & { approval_required?: boolean }
) {
  const sets: string[] = [];
  const params: Record<string, unknown> = { id };
  if (patch.name !== undefined) { sets.push("name = @name"); params.name = patch.name; }
  if (patch.approval_required !== undefined) { sets.push("approval_required = @approval_required"); params.approval_required = patch.approval_required ? 1 : 0; }
  if (patch.confidence_threshold !== undefined) { sets.push("confidence_threshold = @confidence_threshold"); params.confidence_threshold = patch.confidence_threshold; }
  if (patch.plan_tier !== undefined) { sets.push("plan_tier = @plan_tier"); params.plan_tier = patch.plan_tier; }
  if (!sets.length) return;
  getDb().prepare(`UPDATE workspaces SET ${sets.join(", ")} WHERE id = @id`).run(params);
}

export function getWorkspace(id: string): WorkspaceRow | undefined {
  return getDb().prepare("SELECT * FROM workspaces WHERE id = ?").get(id) as WorkspaceRow | undefined;
}

export function listWorkspacesForUser(userId: string): WorkspaceRow[] {
  return getDb()
    .prepare(
      `SELECT w.* FROM workspaces w
       JOIN workspace_members m ON m.workspace_id = w.id
       WHERE m.user_id = ?
       ORDER BY (w.id = 'ws_default') DESC, w.created_at ASC`
    )
    .all(userId) as WorkspaceRow[];
}

/* ------------------------- Memberships ------------------------- */

export interface NewMembershipInput {
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
}

export function upsertMember(m: NewMembershipInput): WorkspaceMembershipRow {
  getDb()
    .prepare(
      `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (@workspace_id, @user_id, @role)
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = excluded.role`
    )
    .run({ workspace_id: m.workspace_id, user_id: m.user_id, role: m.role });
  return getMembership(m.workspace_id, m.user_id)!;
}

export function getMembership(workspaceId: string, userId: string): WorkspaceMembershipRow | undefined {
  return getDb()
    .prepare("SELECT * FROM workspace_members WHERE workspace_id = ? AND user_id = ?")
    .get(workspaceId, userId) as WorkspaceMembershipRow | undefined;
}

export function listMembers(workspaceId: string): (WorkspaceMembershipRow & { name: string; email: string })[] {
  return getDb()
    .prepare(
      `SELECT m.*, u.name, u.email FROM workspace_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = ?
       ORDER BY CASE m.role WHEN 'Admin' THEN 0 WHEN 'Approver' THEN 1 WHEN 'Contributor' THEN 2 ELSE 3 END, m.joined_at`
    )
    .all(workspaceId) as (WorkspaceMembershipRow & { name: string; email: string })[];
}

export function removeMember(workspaceId: string, userId: string) {
  getDb().prepare("DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?").run(workspaceId, userId);
}

export function countMembers(workspaceId: string): number {
  return (getDb().prepare("SELECT COUNT(*) AS n FROM workspace_members WHERE workspace_id = ?").get(workspaceId) as { n: number }).n;
}

/* ------------------------- Documents ------------------------- */

export type NewDocumentInput = Omit<DocumentRow, "created_at" | "ocr_warning" | "source_type" | "source_connection_id" | "current_version_id" | "version_number"> & {
  ocr_warning?: boolean | number;
  source_type?: DocumentSourceType;
  source_connection_id?: string | null;
  current_version_id?: string | null;
  version_number?: number;
};

export function insertDocument(doc: NewDocumentInput) {
  getDb()
    .prepare(
      `INSERT INTO documents (id, workspace_id, owner_id, filename, storage_path, page_count, status, file_hash, ocr_warning, error, source_type, source_connection_id, current_version_id, version_number)
       VALUES (@id, @workspace_id, @owner_id, @filename, @storage_path, @page_count, @status, @file_hash, @ocr_warning, @error, @source_type, @source_connection_id, @current_version_id, @version_number)`
    )
    .run({
      ...doc,
      page_count: doc.page_count ?? 0,
      ocr_warning: doc.ocr_warning ? 1 : 0,
      error: doc.error ?? null,
      source_type: doc.source_type ?? "upload",
      source_connection_id: doc.source_connection_id ?? null,
      current_version_id: doc.current_version_id ?? null,
      version_number: doc.version_number ?? 1,
    });
}

export function updateDocumentStatus(
  id: string,
  patch: Partial<Pick<DocumentRow, "status" | "page_count" | "error" | "current_version_id" | "version_number" | "filename" | "file_hash" | "storage_path">> & { ocr_warning?: boolean }
) {
  const sets: string[] = [];
  const params: Record<string, unknown> = { id };
  if (patch.status !== undefined) { sets.push("status = @status"); params.status = patch.status; }
  if (patch.page_count !== undefined) { sets.push("page_count = @page_count"); params.page_count = patch.page_count; }
  if (patch.ocr_warning !== undefined) { sets.push("ocr_warning = @ocr_warning"); params.ocr_warning = patch.ocr_warning ? 1 : 0; }
  if (patch.error !== undefined) { sets.push("error = @error"); params.error = patch.error; }
  if (patch.current_version_id !== undefined) { sets.push("current_version_id = @current_version_id"); params.current_version_id = patch.current_version_id; }
  if (patch.version_number !== undefined) { sets.push("version_number = @version_number"); params.version_number = patch.version_number; }
  if (patch.filename !== undefined) { sets.push("filename = @filename"); params.filename = patch.filename; }
  if (patch.file_hash !== undefined) { sets.push("file_hash = @file_hash"); params.file_hash = patch.file_hash; }
  if (patch.storage_path !== undefined) { sets.push("storage_path = @storage_path"); params.storage_path = patch.storage_path; }
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

export function countDocuments(workspaceId: string): number {
  return (getDb().prepare("SELECT COUNT(*) AS n FROM documents WHERE workspace_id = ?").get(workspaceId) as { n: number }).n;
}

export function findDocumentByHash(hash: string, workspaceId?: string): DocumentRow | undefined {
  if (workspaceId) {
    return getDb()
      .prepare("SELECT * FROM documents WHERE file_hash = ? AND workspace_id = ? AND status != 'failed' ORDER BY created_at DESC LIMIT 1")
      .get(hash, workspaceId) as DocumentRow | undefined;
  }
  return getDb().prepare("SELECT * FROM documents WHERE file_hash = ? AND status != 'failed' ORDER BY created_at DESC LIMIT 1").get(hash) as
    | DocumentRow
    | undefined;
}

export function deleteDocument(id: string) {
  getDb().prepare("DELETE FROM documents WHERE id = ?").run(id);
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

export function insertDocumentVersion(v: NewDocumentVersionInput): DocumentVersionRow {
  const id = v.id ?? "dver_" + randomUUID();
  getDb()
    .prepare(
      `INSERT INTO document_versions (id, document_id, version_number, uploaded_by, diff_summary, storage_path, file_hash, page_count)
       VALUES (@id, @document_id, @version_number, @uploaded_by, @diff_summary, @storage_path, @file_hash, @page_count)`
    )
    .run({ ...v, id });
  return getDocumentVersion(id)!;
}

export function getDocumentVersion(id: string): DocumentVersionRow | undefined {
  return getDb().prepare("SELECT * FROM document_versions WHERE id = ?").get(id) as DocumentVersionRow | undefined;
}

export function listDocumentVersions(documentId: string): DocumentVersionRow[] {
  return getDb()
    .prepare("SELECT * FROM document_versions WHERE document_id = ? ORDER BY version_number DESC")
    .all(documentId) as DocumentVersionRow[];
}

/* ------------------------- Query logs ---------------- */

const parseQl = (row: QueryLogRow): QueryLogRow => row;

export interface NewQueryLogInput extends Omit<QueryLogRow, "created_at" | "document_ids" | "citations" | "correction_id" | "flagged_needs_review" | "confidence_score" | "confidence_threshold"> {
  document_ids: string[];
  citations?: Citation[];
  correction_id?: string | null;
  confidence_score?: number | null;
  confidence_threshold?: number | null;
  flagged_needs_review?: boolean;
}

export function insertQueryLog(ql: NewQueryLogInput) {
  getDb()
    .prepare(
      `INSERT INTO query_logs (id, workspace_id, user_id, document_ids, question_text, answer_text, source_type, citations, correction_id, feedback_status, retry_of, attempt, strategy_note, confidence_score, confidence_threshold, flagged_needs_review)
       VALUES (@id, @workspace_id, @user_id, @document_ids, @question_text, @answer_text, @source_type, @citations, @correction_id, @feedback_status, @retry_of, @attempt, @strategy_note, @confidence_score, @confidence_threshold, @flagged_needs_review)`
    )
    .run({
      ...ql,
      document_ids: JSON.stringify(ql.document_ids),
      citations: JSON.stringify(ql.citations ?? []),
      correction_id: ql.correction_id ?? null,
      feedback_status: ql.feedback_status ?? "none",
      retry_of: ql.retry_of ?? null,
      confidence_score: ql.confidence_score ?? null,
      confidence_threshold: ql.confidence_threshold ?? null,
      flagged_needs_review: ql.flagged_needs_review ? 1 : 0,
    });
}

export function getQueryLog(id: string): QueryLogRow | undefined {
  const row = getDb().prepare("SELECT * FROM query_logs WHERE id = ?").get(id) as QueryLogRow | undefined;
  return row ? parseQl(row) : undefined;
}

export function setFeedbackStatus(id: string, status: FeedbackStatus) {
  getDb().prepare("UPDATE query_logs SET feedback_status = ? WHERE id = ?").run(status, id);
}

export function listFlaggedLogsSince(workspaceId: string, sinceIso: string): QueryLogRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM query_logs
       WHERE workspace_id = ? AND feedback_status = 'flagged' AND created_at >= ? AND source_type != 'no_answer'
       ORDER BY created_at DESC LIMIT 500`
    )
    .all(workspaceId, sinceIso) as QueryLogRow[];
}

export function hasActiveCorrectionForQuestions(workspaceId: string): Set<string> {
  // Corrections store their own question text; used to exclude already-corrected questions from flag clusters.
  const rows = getDb()
    .prepare("SELECT LOWER(TRIM(question_text)) AS q FROM corrections WHERE workspace_id = ? AND status IN ('active','pending')")
    .all(workspaceId) as Array<{ q: string }>;
  return new Set(rows.map((r) => r.q));
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

export function insertCorrection(input: NewCorrectionInput): CorrectionRow {
  const id = input.id ?? "corr_" + randomUUID();
  const status = input.status ?? "active";
  getDb()
    .prepare(
      `INSERT INTO corrections (id, workspace_id, document_id, original_query_log_id, question_text, topic_tags, wrong_answer_text, corrected_answer_text, note, submitted_by, supersedes_correction_id, scope, status, approved_by, approved_at, suggested_correction_id)
       VALUES (@id, @workspace_id, @document_id, @original_query_log_id, @question_text, @topic_tags, @wrong_answer_text, @corrected_answer_text, @note, @submitted_by, @supersedes_correction_id, @scope, @status, @approved_by, @approved_at, @suggested_correction_id)`
    )
    .run({
      ...input,
      id,
      topic_tags: JSON.stringify(input.topic_tags ?? []),
      note: input.note ?? null,
      supersedes_correction_id: input.supersedes_correction_id ?? null,
      status,
      approved_by: status === "active" ? (input.approved_by ?? input.submitted_by) : null,
      approved_at: status === "active" ? new Date().toISOString().replace("T", " ").slice(0, 23) + "Z" : null,
      suggested_correction_id: input.suggested_correction_id ?? null,
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

export function setCorrectionStatus(
  id: string,
  status: CorrectionStatus,
  supersedesBy?: string,
  extra?: { approved_by?: string | null; rejection_reason?: string | null }
) {
  getDb()
    .prepare(
      `UPDATE corrections SET status = ?,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
        supersedes_correction_id = COALESCE(?, supersedes_correction_id),
        approved_by = COALESCE(?, approved_by),
        approved_at = CASE WHEN ? = 'active' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE approved_at END,
        rejection_reason = COALESCE(?, rejection_reason)
       WHERE id = ?`
    )
    .run(status, supersedesBy ?? null, extra?.approved_by ?? null, status, extra?.rejection_reason ?? null, id);
}

export function setNeedsVersionReview(id: string, flag: boolean) {
  getDb()
    .prepare("UPDATE corrections SET needs_version_review = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
    .run(flag ? 1 : 0, id);
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

export function listCorrections(workspaceId: string, documentId?: string, includeNonLive = true): CorrectionRow[] {
  if (documentId) {
    const liveFilter = includeNonLive ? "" : "AND status IN ('active','pending')";
    return getDb()
      .prepare(
        `SELECT * FROM corrections WHERE workspace_id = ? AND (document_id = ? OR scope = 'workspace') ${liveFilter} ORDER BY created_at DESC`
      )
      .all(workspaceId, documentId) as CorrectionRow[];
  }
  const liveFilter = includeNonLive ? "" : "AND status IN ('active','pending')";
  return getDb()
    .prepare(`SELECT * FROM corrections WHERE workspace_id = ? ${liveFilter} ORDER BY created_at DESC`)
    .all(workspaceId) as CorrectionRow[];
}

/** FR-36: pending approvals queue. */
export function listPendingCorrections(workspaceId: string): CorrectionRow[] {
  return getDb()
    .prepare("SELECT * FROM corrections WHERE workspace_id = ? AND status = 'pending' ORDER BY created_at ASC")
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

export function listCorrectionsNeedingVersionReview(workspaceId: string): CorrectionRow[] {
  return getDb()
    .prepare("SELECT * FROM corrections WHERE workspace_id = ? AND needs_version_review = 1 ORDER BY created_at DESC")
    .all(workspaceId) as CorrectionRow[];
}

/* ------------------------- Comments ------------------------- */

export function insertComment(correctionId: string, authorId: string, body: string): CorrectionCommentRow {
  const id = "cm_" + randomUUID();
  getDb()
    .prepare("INSERT INTO correction_comments (id, correction_id, author_id, body) VALUES (?, ?, ?, ?)")
    .run(id, correctionId, authorId, body);
  return getComment(id)!;
}

export function getComment(id: string): CorrectionCommentRow | undefined {
  return getDb().prepare("SELECT * FROM correction_comments WHERE id = ?").get(id) as CorrectionCommentRow | undefined;
}

export function listComments(correctionId: string): CorrectionCommentRow[] {
  return getDb()
    .prepare("SELECT * FROM correction_comments WHERE correction_id = ? ORDER BY created_at ASC")
    .all(correctionId) as CorrectionCommentRow[];
}

export function deleteCommentsForCorrections(correctionIds: string[]) {
  if (!correctionIds.length) return;
  const ph = correctionIds.map(() => "?").join(",");
  getDb().prepare(`DELETE FROM correction_comments WHERE correction_id IN (${ph})`).run(...correctionIds);
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

export function appendAudit(entry: NewAuditEntry): AuditLogEntryRow {
  const id = "aud_" + randomUUID();
  // Append-only by design (FR-41): INSERT only; no update/delete paths exist anywhere.
  getDb()
    .prepare(
      `INSERT INTO audit_log (id, workspace_id, actor_id, action_type, target_type, target_id, before_state, after_state)
       VALUES (@id, @workspace_id, @actor_id, @action_type, @target_type, @target_id, @before_state, @after_state)`
    )
    .run({
      id,
      workspace_id: entry.workspace_id,
      actor_id: entry.actor_id,
      action_type: entry.action_type,
      target_type: entry.target_type,
      target_id: entry.target_id,
      before_state: entry.before_state === undefined ? null : JSON.stringify(entry.before_state),
      after_state: entry.after_state === undefined ? null : JSON.stringify(entry.after_state),
    });
  return getAuditEntry(id)!;
}

export function getAuditEntry(id: string): AuditLogEntryRow | undefined {
  return getDb().prepare("SELECT * FROM audit_log WHERE id = ?").get(id) as AuditLogEntryRow | undefined;
}

export function listAuditEntries(workspaceId: string, limit = 1000, offset = 0): AuditLogEntryRow[] {
  return getDb()
    .prepare("SELECT * FROM audit_log WHERE workspace_id = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?")
    .all(workspaceId, Math.min(limit, 5000), offset) as AuditLogEntryRow[];
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

export function insertConflictAlert(a: NewConflictAlert): ConflictAlertRow {
  const id = "cfl_" + randomUUID();
  getDb()
    .prepare(
      `INSERT INTO conflict_alerts (id, workspace_id, document_a_id, passage_a_ref, passage_a_text, document_b_id, passage_b_ref, passage_b_text, similarity, rationale)
       VALUES (@id, @workspace_id, @document_a_id, @passage_a_ref, @passage_a_text, @document_b_id, @passage_b_ref, @passage_b_text, @similarity, @rationale)`
    )
    .run({ ...a, id, rationale: a.rationale ?? null });
  return getConflictAlert(id)!;
}

export function getConflictAlert(id: string): ConflictAlertRow | undefined {
  return getDb().prepare("SELECT * FROM conflict_alerts WHERE id = ?").get(id) as ConflictAlertRow | undefined;
}

export function listConflictAlerts(workspaceId: string, status?: "open" | "resolved" | "dismissed"): ConflictAlertRow[] {
  if (status) {
    return getDb()
      .prepare("SELECT * FROM conflict_alerts WHERE workspace_id = ? AND status = ? ORDER BY detected_at DESC")
      .all(workspaceId, status) as ConflictAlertRow[];
  }
  return getDb()
    .prepare("SELECT * FROM conflict_alerts WHERE workspace_id = ? ORDER BY detected_at DESC LIMIT 200")
    .all(workspaceId) as ConflictAlertRow[];
}

export function findExistingConflict(workspaceId: string, refA: string, refB: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT id FROM conflict_alerts WHERE workspace_id = ? AND status = 'open' AND
       ((passage_a_ref = ? AND passage_b_ref = ?) OR (passage_a_ref = ? AND passage_b_ref = ?)) LIMIT 1`
    )
    .get(workspaceId, refA, refB, refB, refA);
  return Boolean(row);
}

export function setConflictStatus(id: string, status: "open" | "resolved" | "dismissed") {
  getDb().prepare("UPDATE conflict_alerts SET status = ? WHERE id = ?").run(status, id);
}

/* ------------------------- Integrations ------------------------- */

export interface UpsertConnectionInput {
  workspace_id: string;
  provider: IntegrationConnectionRow["provider"];
  display_name?: string;
  auth_credentials_encrypted?: string | null;
  sync_status?: IntegrationConnectionRow["sync_status"];
}

export function upsertIntegrationConnection(c: UpsertConnectionInput): IntegrationConnectionRow {
  getDb()
    .prepare(
      `INSERT INTO integration_connections (id, workspace_id, provider, display_name, auth_credentials, sync_status)
       VALUES (@id, @workspace_id, @provider, @display_name, @auth_credentials, @sync_status)
       ON CONFLICT (workspace_id, provider) DO UPDATE SET
         display_name = excluded.display_name,
         auth_credentials = COALESCE(excluded.auth_credentials, auth_credentials),
         sync_status = excluded.sync_status`
    )
    .run({
      id: "icn_" + randomUUID(),
      workspace_id: c.workspace_id,
      provider: c.provider,
      display_name: c.display_name ?? "",
      auth_credentials: c.auth_credentials_encrypted ?? null,
      sync_status: c.sync_status ?? "connected",
    });
  return getIntegrationConnection(c.workspace_id, c.provider)!;
}

export function getIntegrationConnection(workspaceId: string, provider: string): IntegrationConnectionRow | undefined {
  return getDb()
    .prepare("SELECT * FROM integration_connections WHERE workspace_id = ? AND provider = ?")
    .get(workspaceId, provider) as IntegrationConnectionRow | undefined;
}

export function listIntegrationConnections(workspaceId: string): IntegrationConnectionRow[] {
  return getDb()
    .prepare("SELECT * FROM integration_connections WHERE workspace_id = ? ORDER BY created_at ASC")
    .all(workspaceId) as IntegrationConnectionRow[];
}

export function deleteIntegrationConnection(workspaceId: string, provider: string) {
  getDb()
    .prepare("DELETE FROM integration_connections WHERE workspace_id = ? AND provider = ?")
    .run(workspaceId, provider);
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

export function insertApiKey(k: NewApiKeyInput): ApiKeyRow {
  const id = "key_" + randomUUID();
  getDb()
    .prepare(
      `INSERT INTO api_keys (id, workspace_id, key_hash, key_prefix, scopes, created_by, name)
       VALUES (@id, @workspace_id, @key_hash, @key_prefix, @scopes, @created_by, @name)`
    )
    .run({ ...k, id, scopes: JSON.stringify(k.scopes), name: k.name ?? "" });
  return getApiKey(id)!;
}

export function getApiKey(id: string): ApiKeyRow | undefined {
  return getDb().prepare("SELECT * FROM api_keys WHERE id = ?").get(id) as ApiKeyRow | undefined;
}

export function findApiKeyByHash(keyHash: string): ApiKeyRow | undefined {
  return getDb().prepare("SELECT * FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL").get(keyHash) as ApiKeyRow | undefined;
}

export function listApiKeys(workspaceId: string): ApiKeyRow[] {
  return getDb()
    .prepare("SELECT * FROM api_keys WHERE workspace_id = ? ORDER BY created_at DESC")
    .all(workspaceId) as ApiKeyRow[];
}

export function revokeApiKey(id: string) {
  getDb()
    .prepare("UPDATE api_keys SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND revoked_at IS NULL")
    .run(id);
}

/* ------------------------- Suggested corrections ------------------------- */

export interface NewSuggestedCorrection {
  workspace_id: string;
  source_pattern: unknown;
  canonical_question: string;
  suggested_text: string;
  rationale?: string | null;
}

export function insertSuggestedCorrection(s: NewSuggestedCorrection): SuggestedCorrectionRow {
  const id = "sug_" + randomUUID();
  getDb()
    .prepare(
      `INSERT INTO suggested_corrections (id, workspace_id, source_pattern, canonical_question, suggested_text, rationale)
       VALUES (@id, @workspace_id, @source_pattern, @canonical_question, @suggested_text, @rationale)`
    )
    .run({
      id,
      workspace_id: s.workspace_id,
      source_pattern: JSON.stringify(s.source_pattern),
      canonical_question: s.canonical_question,
      suggested_text: s.suggested_text,
      rationale: s.rationale ?? null,
    });
  return getSuggestedCorrection(id)!;
}

export function getSuggestedCorrection(id: string): SuggestedCorrectionRow | undefined {
  return getDb().prepare("SELECT * FROM suggested_corrections WHERE id = ?").get(id) as SuggestedCorrectionRow | undefined;
}

export function listSuggestedCorrections(workspaceId: string, status?: "pending" | "accepted" | "dismissed"): SuggestedCorrectionRow[] {
  if (status) {
    return getDb()
      .prepare("SELECT * FROM suggested_corrections WHERE workspace_id = ? AND status = ? ORDER BY generated_at DESC LIMIT 100")
      .all(workspaceId, status) as SuggestedCorrectionRow[];
  }
  return getDb()
    .prepare("SELECT * FROM suggested_corrections WHERE workspace_id = ? ORDER BY generated_at DESC LIMIT 100")
    .all(workspaceId) as SuggestedCorrectionRow[];
}

export function setSuggestedCorrectionStatus(id: string, status: "pending" | "accepted" | "dismissed") {
  getDb().prepare("UPDATE suggested_corrections SET status = ? WHERE id = ?").run(status, id);
}

export function findSimilarPendingSuggestion(workspaceId: string, canonicalQuestion: string): SuggestedCorrectionRow | undefined {
  return getDb()
    .prepare(
      "SELECT * FROM suggested_corrections WHERE workspace_id = ? AND status = 'pending' AND REPLACE(LOWER(TRIM(canonical_question)), ' ', '') = ? LIMIT 1"
    )
    .get(workspaceId, canonicalQuestion.toLowerCase().replace(/\s+/g, "")) as SuggestedCorrectionRow | undefined;
}

/* ------------------------- Webhooks ------------------------- */

export interface NewWebhookEndpoint {
  workspace_id: string;
  url: string;
  secret: string;
  events: string[];
  active?: boolean;
}

export function insertWebhookEndpoint(w: NewWebhookEndpoint): WebhookEndpointRow {
  const id = "whk_" + randomUUID();
  getDb()
    .prepare(
      `INSERT INTO webhook_endpoints (id, workspace_id, url, secret, events, active) VALUES (@id, @workspace_id, @url, @secret, @events, @active)`
    )
    .run({ ...w, id, events: JSON.stringify(w.events), active: w.active === false ? 0 : 1 });
  return getWebhookEndpoint(id)!;
}

export function getWebhookEndpoint(id: string): WebhookEndpointRow | undefined {
  return getDb().prepare("SELECT * FROM webhook_endpoints WHERE id = ?").get(id) as WebhookEndpointRow | undefined;
}

export function listWebhookEndpoints(workspaceId: string): WebhookEndpointRow[] {
  return getDb()
    .prepare("SELECT * FROM webhook_endpoints WHERE workspace_id = ? ORDER BY created_at ASC")
    .all(workspaceId) as WebhookEndpointRow[];
}

export function deleteWebhookEndpoint(id: string) {
  getDb().prepare("DELETE FROM webhook_endpoints WHERE id = ?").run(id);
}
