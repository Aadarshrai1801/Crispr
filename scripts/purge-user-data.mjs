/**
 * GDPR-style data removal for a user (audit item N9).
 *
 *   node scripts/purge-user-data.mjs <user_id_or_email>
 *
 * Removes: sessions, query logs (full Q&A text), authored correction comments,
 * suggested-correction authorship references, and workspace memberships.
 * The user row is ANONYMIZED rather than deleted so corrections they submitted
 * keep referential integrity for their team; audit_log entries are append-only
 * by compliance design and retain actor ids — see SECURITY.md.
 */
import Database from "better-sqlite3";
import path from "node:path";

const dataDir = path.resolve(process.cwd(), process.env.DATA_DIR ?? "./data");
const db = new Database(path.join(dataDir, "crisp.db"));
db.pragma("journal_mode = WAL");

const identifier = process.argv[2];
if (!identifier) {
  console.error("Usage: node scripts/purge-user-data.mjs <user_id_or_email>");
  process.exit(1);
}

const user = db
  .prepare("SELECT id FROM users WHERE id = ? OR lower(email) = lower(?)")
  .get(identifier, identifier);
if (!user) {
  console.error(`No user found for '${identifier}'.`);
  process.exit(1);
}
const userId = user.id;

const counts = {};
counts.query_logs = db.prepare("DELETE FROM query_logs WHERE user_id = ?").run(userId).changes;
counts.comments = db.prepare("DELETE FROM correction_comments WHERE author_id = ?").run(userId).changes;
counts.sessions = db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId).changes;
counts.memberships = db.prepare("DELETE FROM workspace_members WHERE user_id = ?").run(userId).changes;
counts.suggestions_authored = db
  .prepare("UPDATE corrections SET submitted_by = 'deleted_user' WHERE submitted_by = ?")
  .run(userId).changes;
counts.api_keys_revoked = db
  .prepare("UPDATE api_keys SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE created_by = ? AND revoked_at IS NULL")
  .run(userId).changes;
db.prepare(
  "UPDATE users SET name = 'Deleted User', email = 'deleted-' || substr(id, 1, 10) || '@invalid', password_hash = NULL WHERE id = ?"
).run(userId);

console.log(`Purged personal data for ${userId}:`);
for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);
console.log("Note: append-only audit_log entries retain actor ids by compliance design (SECURITY.md).");
db.close();
