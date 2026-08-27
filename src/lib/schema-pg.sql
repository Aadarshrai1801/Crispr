-- Crispr online schema (Supabase / PostgreSQL + pgvector)
-- Run once against the remote database (e.g. via Supabase SQL editor or
-- `psql "$DATABASE_URL" -f src/lib/schema-pg.sql`). Idempotent / additive.
--
-- See README section "Online storage (Supabase)" for the migration procedure.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Embedding vectors for retrieval. Dimension is fixed at 384 by the default
-- MiniLM-L6-v2 model. Recreate the index if you change EMBED_DIM.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector extension unavailable: %', SQLERRM;
END $$;

-- --------------------------------------------------------------- users
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  password_hash TEXT
);

-- ----------------------------------------------------------- sessions
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- --------------------------------------------------------- workspaces
CREATE TABLE IF NOT EXISTS workspaces (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  owner_id            TEXT,
  member_ids          TEXT NOT NULL DEFAULT '[]',
  approval_required   INTEGER NOT NULL DEFAULT 0,
  confidence_threshold REAL NOT NULL DEFAULT 0.55,
  plan_tier           TEXT NOT NULL DEFAULT 'team',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------ workspace_members
CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'Viewer',
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

-- ------------------------------------------------------------ documents
CREATE TABLE IF NOT EXISTS documents (
  id                  TEXT PRIMARY KEY,
  workspace_id        TEXT NOT NULL,
  owner_id            TEXT NOT NULL,
  filename            TEXT NOT NULL,
  storage_path        TEXT NOT NULL,
  page_count          INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'processing',
  file_hash           TEXT NOT NULL,
  ocr_warning         INTEGER NOT NULL DEFAULT 0,
  error               TEXT,
  source_type         TEXT NOT NULL DEFAULT 'upload',
  source_connection_id TEXT,
  current_version_id  TEXT,
  version_number      INTEGER NOT NULL DEFAULT 1,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_documents_ws ON documents(workspace_id);

-- ------------------------------------------------------ document_versions
CREATE TABLE IF NOT EXISTS document_versions (
  id             TEXT PRIMARY KEY,
  document_id    TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  uploaded_by    TEXT NOT NULL,
  diff_summary   TEXT,
  storage_path   TEXT NOT NULL,
  file_hash      TEXT NOT NULL,
  page_count     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_docver_doc ON document_versions(document_id);

-- ------------------------------------------------------------ query_logs
CREATE TABLE IF NOT EXISTS query_logs (
  id                  TEXT PRIMARY KEY,
  workspace_id        TEXT NOT NULL,
  user_id             TEXT NOT NULL,
  document_ids        TEXT NOT NULL DEFAULT '[]',
  question_text       TEXT NOT NULL,
  answer_text         TEXT NOT NULL,
  source_type         TEXT NOT NULL DEFAULT 'document',
  citations           TEXT NOT NULL DEFAULT '[]',
  correction_id       TEXT,
  feedback_status     TEXT NOT NULL DEFAULT 'none',
  retry_of            TEXT,
  attempt             INTEGER NOT NULL DEFAULT 0,
  strategy_note       TEXT NOT NULL DEFAULT '',
  confidence_score    REAL,
  confidence_threshold REAL,
  flagged_needs_review INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qlog_ws_time ON query_logs(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_qlog_user ON query_logs(user_id);

-- ----------------------------------------------------------- corrections
CREATE TABLE IF NOT EXISTS corrections (
  id                       TEXT PRIMARY KEY,
  workspace_id             TEXT NOT NULL,
  document_id              TEXT,
  original_query_log_id    TEXT NOT NULL,
  question_text            TEXT NOT NULL,
  topic_tags               TEXT NOT NULL DEFAULT '[]',
  wrong_answer_text        TEXT NOT NULL,
  corrected_answer_text    TEXT NOT NULL,
  note                     TEXT,
  submitted_by             TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'active',
  supersedes_correction_id TEXT,
  scope                    TEXT NOT NULL DEFAULT 'document',
  served_count             INTEGER NOT NULL DEFAULT 0,
  confirmed_count          INTEGER NOT NULL DEFAULT 0,
  approved_by              TEXT,
  approved_at              TIMESTAMPTZ,
  rejection_reason         TEXT,
  needs_version_review     INTEGER NOT NULL DEFAULT 0,
  suggested_correction_id  TEXT,
  pending_edit             TEXT,
  pending_edit_by          TEXT,
  pending_edit_at          TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_corrections_ws ON corrections(workspace_id, status);

-- ------------------------------------------------------ correction_comments
CREATE TABLE IF NOT EXISTS correction_comments (
  id            TEXT PRIMARY KEY,
  correction_id TEXT NOT NULL,
  author_id     TEXT NOT NULL,
  body          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comments_corr ON correction_comments(correction_id);

-- -------------------------------------------------------------- audit_log
CREATE TABLE IF NOT EXISTS audit_log (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  actor_id     TEXT NOT NULL,
  action_type  TEXT NOT NULL,
  target_type  TEXT NOT NULL,
  target_id    TEXT NOT NULL,
  before_state TEXT,
  after_state  TEXT,
  timestamp    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_ws ON audit_log(workspace_id, timestamp);

-- --------------------------------------------------------- conflict_alerts
CREATE TABLE IF NOT EXISTS conflict_alerts (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL,
  document_a_id TEXT NOT NULL,
  passage_a_ref TEXT NOT NULL,
  passage_a_text TEXT NOT NULL DEFAULT '',
  document_b_id TEXT NOT NULL,
  passage_b_ref TEXT NOT NULL,
  passage_b_text TEXT NOT NULL DEFAULT '',
  similarity    REAL NOT NULL DEFAULT 0,
  rationale     TEXT,
  status        TEXT NOT NULL DEFAULT 'open',
  detected_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conflicts_ws ON conflict_alerts(workspace_id, status);

-- --------------------------------------------------- integration_connections
CREATE TABLE IF NOT EXISTS integration_connections (
  id               TEXT PRIMARY KEY,
  workspace_id     TEXT NOT NULL,
  provider         TEXT NOT NULL,
  display_name     TEXT NOT NULL DEFAULT '',
  auth_credentials TEXT,
  sync_status      TEXT NOT NULL DEFAULT 'disconnected',
  last_synced_at   TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, provider)
);

-- --------------------------------------------------------------- api_keys
CREATE TABLE IF NOT EXISTS api_keys (
  id          TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  key_hash    TEXT NOT NULL UNIQUE,
  key_prefix  TEXT NOT NULL,
  scopes      TEXT NOT NULL DEFAULT '[]',
  created_by  TEXT NOT NULL,
  name        TEXT NOT NULL DEFAULT '',
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------ suggested_corrections
CREATE TABLE IF NOT EXISTS suggested_corrections (
  id               TEXT PRIMARY KEY,
  workspace_id     TEXT NOT NULL,
  source_pattern   TEXT NOT NULL,
  canonical_question TEXT NOT NULL,
  suggested_text   TEXT NOT NULL DEFAULT '',
  rationale        TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',
  generated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_suggestions_ws ON suggested_corrections(workspace_id, status);

-- ------------------------------------------------------- webhook_endpoints
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id          TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  url         TEXT NOT NULL,
  secret      TEXT NOT NULL,
  events      TEXT NOT NULL DEFAULT '[]',
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------ ingest_jobs
CREATE TABLE IF NOT EXISTS ingest_jobs (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL DEFAULT 'pending',
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON ingest_jobs(status, created_at);

-- ------------------------------------------------------- chat_sessions
CREATE TABLE IF NOT EXISTS chat_sessions (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  workspace_id    TEXT NOT NULL,
  title           TEXT NOT NULL DEFAULT 'New chat',
  document_ids    TEXT NOT NULL DEFAULT '[]',
  status          TEXT NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_ws ON chat_sessions(user_id, workspace_id, created_at);

-- ------------------------------------------------------- chat_messages
CREATE TABLE IF NOT EXISTS chat_messages (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL,
  role         TEXT NOT NULL,
  content      TEXT NOT NULL,
  query_log_id TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON chat_messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_qlog ON chat_messages(query_log_id);

-- ============================================================ VECTORS
-- chunks: one row per document chunk with its embedding.
CREATE TABLE IF NOT EXISTS chunks (
  id           TEXT PRIMARY KEY,
  document_id  TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  page_number  INTEGER NOT NULL DEFAULT 0,
  section_label TEXT NOT NULL DEFAULT '',
  text         TEXT NOT NULL DEFAULT '',
  embedding    vector(384) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_chunks_ws ON chunks(workspace_id);

-- corrections_index: override embeddings used for correction matching.
CREATE TABLE IF NOT EXISTS corrections_index (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  document_id  TEXT NOT NULL,
  scope        TEXT NOT NULL DEFAULT 'document',
  embedding    vector(384) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_corrections_index_ws ON corrections_index(workspace_id);

-- HNSW index for approximate cosine search. `=>` is negative cosine distance.
DO $$
BEGIN
  CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON chunks
    USING hnsw (embedding vector_cosine_ops);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'hnsw index skipped: %', SQLERRM;
END $$;
DO $$
BEGIN
  CREATE INDEX IF NOT EXISTS idx_corrections_embedding ON corrections_index
    USING hnsw (embedding vector_cosine_ops);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'hnsw index skipped: %', SQLERRM;
END $$;

-- RLS is enabled at the table level here as a readiness signal; per-workspace
-- policies are intentionally left for the app/RPC layer that carries the
-- authenticated user context (see README). The server uses the service-role key
-- which bypasses RLS, so application authorization still governs access.

