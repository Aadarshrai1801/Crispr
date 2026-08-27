import * as pg from "pg";
import lancedb from "@lancedb/lancedb";
import { createClient } from "@supabase/supabase-js";
import Database from "better-sqlite3";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "..");
const DATA_DIR = join(PROJECT_ROOT, "data");

function loadEnv() {
  const envPath = join(PROJECT_ROOT, ".env.local");
  if (!existsSync(envPath)) {
    console.error(".env.local not found");
    process.exit(1);
  }
  const content = readFileSync(envPath, "utf8");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key) process.env[key] = value;
  }
}

loadEnv();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !DATABASE_URL) {
  console.error("Missing Supabase env vars in .env.local");
  process.exit(1);
}

const pgPool = new pg.Pool({ connectionString: DATABASE_URL });
const sbClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const sqlite = new Database(join(DATA_DIR, "crisp.db"));
sqlite.pragma("journal_mode = WAL");

function toPlainArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === "object" && typeof v.get === "function") {
    const arr = [];
    for (let i = 0; i < v.length; i++) arr.push(v.get(i));
    return arr;
  }
  if (v.data && v.data.values && v.data.values[0]) {
    return Array.from(v.data.values[0]);
  }
  return [];
}

function sanitizeText(v) {
  if (typeof v !== "string") return v;
  return v.replace(/\0/g, "");
}

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "documents";

async function pgQuery(sql, params = []) {
  return pgPool.query(sql, params);
}

async function truncateAll() {
  console.log("Truncating Supabase tables...");
  const tables = [
    "chat_messages",
    "chat_sessions",
    "ingest_jobs",
    "document_versions",
    "documents",
    "corrections_index",
    "chunks",
    "corrections",
    "correction_comments",
    "query_logs",
    "conflict_alerts",
    "suggested_corrections",
    "webhook_endpoints",
    "api_keys",
    "integration_connections",
    "audit_log",
    "workspace_members",
    "workspaces",
    "sessions",
    "users",
  ];
  await pgQuery(`TRUNCATE TABLE ${tables.join(", ")} RESTART IDENTITY CASCADE`);
  console.log("Truncated.");
}

async function migrateTable(table, columns, rows, pkColumn) {
  if (!rows.length) return;
  const colList = columns.join(", ");
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
  const stmt = `INSERT INTO ${table} (${colList}) VALUES (${placeholders})`;
  let migrated = 0;
  for (const row of rows) {
    const values = columns.map((c) => {
      const v = row[c];
      if (v === undefined || v === null) return null;
      return v;
    });
    await pgQuery(stmt, values);
    migrated++;
  }
  console.log(`  ${table}: ${migrated} rows`);
}

async function migrateData() {
  console.log("Migrating relational data...");

  // Users
  const users = sqlite.prepare("SELECT * FROM users").all();
  await migrateTable(
    "users",
    ["id", "name", "email", "password_hash"],
    users,
    "id"
  );

  // Workspaces
  const workspaces = sqlite.prepare("SELECT * FROM workspaces").all();
  await migrateTable(
    "workspaces",
    [
      "id", "name", "owner_id", "member_ids", "approval_required",
      "confidence_threshold", "plan_tier", "created_at",
    ],
    workspaces,
    "id"
  );

  // Workspace members
  const members = sqlite.prepare("SELECT * FROM workspace_members").all();
  await migrateTable(
    "workspace_members",
    ["workspace_id", "user_id", "role", "joined_at"],
    members,
    "workspace_id"
  );

  // Documents
  const documents = sqlite.prepare("SELECT * FROM documents").all();
  await migrateTable(
    "documents",
    [
      "id", "workspace_id", "owner_id", "filename", "storage_path",
      "page_count", "status", "file_hash", "ocr_warning", "error",
      "source_type", "source_connection_id", "current_version_id",
      "version_number", "created_at",
    ],
    documents,
    "id"
  );

  // Document versions
  const docVersions = sqlite.prepare("SELECT * FROM document_versions").all();
  await migrateTable(
    "document_versions",
    [
      "id", "document_id", "version_number", "uploaded_at", "uploaded_by",
      "diff_summary", "storage_path", "file_hash", "page_count",
    ],
    docVersions,
    "id"
  );

  // Query logs
  const queryLogs = sqlite.prepare("SELECT * FROM query_logs").all();
  await migrateTable(
    "query_logs",
    [
      "id", "workspace_id", "user_id", "document_ids", "question_text",
      "answer_text", "source_type", "citations", "correction_id",
      "feedback_status", "retry_of", "attempt", "strategy_note",
      "confidence_score", "confidence_threshold", "flagged_needs_review",
      "created_at",
    ],
    queryLogs,
    "id"
  );

  // Corrections
  const corrections = sqlite.prepare("SELECT * FROM corrections").all();
  await migrateTable(
    "corrections",
    [
      "id", "workspace_id", "document_id", "original_query_log_id",
      "question_text", "topic_tags", "wrong_answer_text", "corrected_answer_text",
      "note", "submitted_by", "supersedes_correction_id", "scope", "status",
      "approved_by", "approved_at", "rejection_reason", "needs_version_review",
      "suggested_correction_id", "pending_edit", "pending_edit_by",
      "pending_edit_at", "created_at", "updated_at",
    ],
    corrections,
    "id"
  );

  // Correction comments
  const comments = sqlite.prepare("SELECT * FROM correction_comments").all();
  await migrateTable(
    "correction_comments",
    ["id", "correction_id", "author_id", "body", "created_at"],
    comments,
    "id"
  );

  // Audit log
  const auditLog = sqlite.prepare("SELECT * FROM audit_log").all();
  await migrateTable(
    "audit_log",
    [
      "id", "workspace_id", "actor_id", "action_type", "target_type",
      "target_id", "before_state", "after_state", "timestamp",
    ],
    auditLog,
    "id"
  );

  // Conflict alerts
  const conflicts = sqlite.prepare("SELECT * FROM conflict_alerts").all();
  await migrateTable(
    "conflict_alerts",
    [
      "id", "workspace_id", "document_a_id", "passage_a_ref", "passage_a_text",
      "document_b_id", "passage_b_ref", "passage_b_text", "similarity",
      "rationale", "status", "detected_at",
    ],
    conflicts,
    "id"
  );

  // Integration connections
  const integrations = sqlite.prepare("SELECT * FROM integration_connections").all();
  await migrateTable(
    "integration_connections",
    [
      "id", "workspace_id", "provider", "display_name", "auth_credentials",
      "sync_status", "last_synced_at", "created_at",
    ],
    integrations,
    "id"
  );

  // API keys
  const apiKeys = sqlite.prepare("SELECT * FROM api_keys").all();
  await migrateTable(
    "api_keys",
    [
      "id", "workspace_id", "key_hash", "key_prefix", "scopes",
      "created_by", "name", "revoked_at", "created_at",
    ],
    apiKeys,
    "id"
  );

  // Suggested corrections
  const suggestions = sqlite.prepare("SELECT * FROM suggested_corrections").all();
  await migrateTable(
    "suggested_corrections",
    [
      "id", "workspace_id", "source_pattern", "canonical_question",
      "suggested_text", "rationale", "status", "generated_at",
    ],
    suggestions,
    "id"
  );

  // Webhook endpoints
  const webhooks = sqlite.prepare("SELECT * FROM webhook_endpoints").all();
  await migrateTable(
    "webhook_endpoints",
    [
      "id", "workspace_id", "url", "secret", "events", "active", "created_at",
    ],
    webhooks,
    "id"
  );

  // Ingest jobs
  const ingestJobs = sqlite.prepare("SELECT * FROM ingest_jobs").all();
  await migrateTable(
    "ingest_jobs",
    [
      "id", "document_id", "status", "attempts", "last_error",
      "created_at", "updated_at",
    ],
    ingestJobs,
    "id"
  );

  // Chat sessions
  const chatSessions = sqlite.prepare("SELECT * FROM chat_sessions").all();
  await migrateTable(
    "chat_sessions",
    [
      "id", "user_id", "workspace_id", "title", "document_ids",
      "status", "created_at", "updated_at", "last_message_at",
    ],
    chatSessions,
    "id"
  );

  // Chat messages
  const chatMessages = sqlite.prepare("SELECT * FROM chat_messages").all();
  await migrateTable(
    "chat_messages",
    ["id", "session_id", "role", "content", "query_log_id", "created_at"],
    chatMessages,
    "id"
  );

  // Sessions
  const sessions = sqlite.prepare("SELECT * FROM sessions").all();
  await migrateTable(
    "sessions",
    ["token_hash", "user_id", "created_at", "expires_at"],
    sessions,
    "token_hash"
  );
}

async function migrateVectors() {
  console.log("Migrating vectors...");
  const lancedbConn = await lancedb.connect(join(DATA_DIR, "lancedb"));

  // Migrate chunks
  const chunksTable = await lancedbConn.openTable("chunks");
  const chunks = await chunksTable.query().limit(100000).toArray();
  console.log(`  LanceDB chunks raw count: ${chunks.length}`);
  if (chunks.length) {
    const batchSize = 200;
    let migratedChunks = 0;
    const client = await (await pgPool.connect());
    try {
      await client.query("BEGIN");
      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        const values = [];
        const params = [];
        for (const c of batch) {
          const vec = toPlainArray(c.vector);
          if (!vec.length) continue;
          const vecStr = `[${vec.map((v) => Number(v).toFixed(6)).join(",")}]`;
          values.push(`($${params.length + 1},$${params.length + 2},$${params.length + 3},$${params.length + 4},$${params.length + 5},$${params.length + 6},$${params.length + 7}::vector)`);
          params.push(
            c.id,
            c.document_id,
            c.workspace_id,
            c.page_number ?? 0,
            sanitizeText(c.section_label ?? ""),
            sanitizeText(c.text ?? ""),
            vecStr,
          );
        }
        if (!values.length) continue;
        const sql = `INSERT INTO chunks (id, document_id, workspace_id, page_number, section_label, text, embedding) VALUES ${values.join(",")} ON CONFLICT (id) DO UPDATE SET document_id = EXCLUDED.document_id, workspace_id = EXCLUDED.workspace_id, page_number = EXCLUDED.page_number, section_label = EXCLUDED.section_label, text = EXCLUDED.text, embedding = EXCLUDED.embedding`;
        await client.query(sql, params);
        migratedChunks += values.length;
      }
      await client.query("COMMIT");
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch {}
      throw e;
    } finally {
      client.release();
    }
    console.log(`  chunks: ${migratedChunks} rows`);
  }

  // Migrate corrections_index
  const corrTable = await lancedbConn.openTable("corrections_index");
  const corrVectors = await corrTable.query().limit(100000).toArray();
  console.log(`  LanceDB corrections_index raw count: ${corrVectors.length}`);
  if (corrVectors.length) {
    const batchSize = 200;
    let migratedCorr = 0;
    const client = await (await pgPool.connect());
    try {
      await client.query("BEGIN");
      for (let i = 0; i < corrVectors.length; i += batchSize) {
        const batch = corrVectors.slice(i, i + batchSize);
        const values = [];
        const params = [];
        for (const c of batch) {
          const vec = toPlainArray(c.vector);
          if (!vec.length) continue;
          const vecStr = `[${vec.map((v) => Number(v).toFixed(6)).join(",")}]`;
          values.push(`($${params.length + 1},$${params.length + 2},$${params.length + 3},$${params.length + 4},$${params.length + 5}::vector)`);
          params.push(
            c.id,
            c.workspace_id,
            c.document_id ?? "",
            c.scope ?? "document",
            vecStr,
          );
        }
        if (!values.length) continue;
        const sql = `INSERT INTO corrections_index (id, workspace_id, document_id, scope, embedding) VALUES ${values.join(",")} ON CONFLICT (id) DO UPDATE SET workspace_id = EXCLUDED.workspace_id, document_id = EXCLUDED.document_id, scope = EXCLUDED.scope, embedding = EXCLUDED.embedding`;
        await client.query(sql, params);
        migratedCorr += values.length;
      }
      await client.query("COMMIT");
      console.log(`  corrections_index: ${migratedCorr} rows`);
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch {}
      throw e;
    } finally {
      client.release();
    }
  }
}

async function migrateFiles() {
  console.log("Migrating files to Supabase Storage...");
  const { data: bucketData, error: bucketError } = await sbClient.storage.getBucket(BUCKET);
  if (bucketError || !bucketData) {
    await sbClient.storage.createBucket(BUCKET, { public: false });
    console.log(`  Created bucket: ${BUCKET}`);
  }

  const docs = sqlite.prepare("SELECT id, filename, storage_path FROM documents WHERE storage_path IS NOT NULL AND storage_path != ''").all();
  let migrated = 0;
  for (const doc of docs) {
    const localPath = doc.storage_path;
    if (!existsSync(localPath)) {
      console.warn(`  Missing file: ${localPath}`);
      continue;
    }
    const ext = doc.filename ? doc.filename.split(".").pop() : "bin";
    const objectKey = `${doc.id}.${ext}`;
    const fileBuffer = readFileSync(localPath);
    const { error: uploadError } = await sbClient.storage
      .from(BUCKET)
      .upload(objectKey, fileBuffer, { upsert: true, contentType: "application/octet-stream" });
    if (uploadError) {
      console.warn(`  Failed to upload ${doc.id}: ${uploadError.message}`);
      continue;
    }
    await pgQuery("UPDATE documents SET storage_path = $1 WHERE id = $2", [objectKey, doc.id]);
    migrated++;
  }
  console.log(`  Files: ${migrated} uploaded`);
}

async function verify() {
  console.log("Verifying migration...");
  const checks = [
    { name: "users", sql: "SELECT count(*) AS n FROM users" },
    { name: "workspaces", sql: "SELECT count(*) AS n FROM workspaces" },
    { name: "documents", sql: "SELECT count(*) AS n FROM documents" },
    { name: "query_logs", sql: "SELECT count(*) AS n FROM query_logs" },
    { name: "corrections", sql: "SELECT count(*) AS n FROM corrections" },
    { name: "chunks", sql: "SELECT count(*) AS n FROM chunks" },
    { name: "corrections_index", sql: "SELECT count(*) AS n FROM corrections_index" },
  ];
  for (const c of checks) {
    const r = await pgQuery(c.sql);
    console.log(`  ${c.name}: ${r.rows[0].n}`);
  }
}

async function main() {
  try {
    await truncateAll();
    await migrateData();
    await migrateVectors();
    await migrateFiles();
    await verify();
    console.log("\nMigration complete.");
  } catch (e) {
    console.error("Migration failed:", e);
    process.exit(1);
  } finally {
    sqlite.close();
    await pgPool.end();
  }
}

main();
