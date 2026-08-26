/**
 * Backup: SQLite snapshot (via better-sqlite3's online backup API) + LanceDB
 * directory copy. See docs/backup.md for the restore procedure.
 *
 *   node scripts/backup.mjs [targetDir]     # default: ./backups/<timestamp>
 */
import Database from "better-sqlite3";
import { cpSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";

const dataDir = path.resolve(process.cwd(), process.env.DATA_DIR ?? "./data");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const targetDir = path.resolve(process.argv[2] ?? path.join(process.cwd(), "backups", stamp));
mkdirSync(targetDir, { recursive: true });

const dbPath = path.join(dataDir, "crisp.db");
if (!existsSync(dbPath)) {
  console.error(`No database found at ${dbPath}`);
  process.exit(1);
}

// Online backup — safe while the server is running (WAL mode).
const db = new Database(dbPath, { readonly: true });
await db.backup(path.join(targetDir, "crisp.db"));
db.close();
console.log(`SQLite backed up -> ${path.join(targetDir, "crisp.db")}`);

const lanceDir = path.join(dataDir, "lancedb");
if (existsSync(lanceDir)) {
  // Consistency note: run while ingestion is idle (check /api/ready or the
  // ingest_jobs table) so no vector write is mid-flight.
  cpSync(lanceDir, path.join(targetDir, "lancedb"), { recursive: true });
  console.log(`LanceDB copied   -> ${path.join(targetDir, "lancedb")}`);
} else {
  console.warn("No lancedb directory found — skipping.");
}

const uploads = path.join(dataDir, "uploads");
if (existsSync(uploads)) {
  cpSync(uploads, path.join(targetDir, "uploads"), { recursive: true });
  console.log(`Uploads copied   -> ${path.join(targetDir, "uploads")}`);
}

console.log(`Backup complete at ${targetDir}`);
