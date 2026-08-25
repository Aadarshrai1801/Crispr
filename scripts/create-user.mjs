/**
 * Production bootstrap: create a user with a password (blocker #1 support).
 *
 *   node scripts/create-user.mjs "Ada Lovelace" ada@company.com 'S3cret!' [--admin]
 *
 * --admin also grants the Admin role in the default workspace. Run after the
 * app has booted at least once (schema is migrated by the server).
 */
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { randomBytes, scryptSync } from "node:crypto";
import path from "node:path";

const dataDir = path.resolve(process.cwd(), process.env.DATA_DIR ?? "./data");
mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, "crisp.db"));
db.pragma("journal_mode = WAL");

function hashPassword(password) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64);
  return `scrypt:${salt.toString("base64url")}:${key.toString("base64url")}`;
}

const [name, email, password] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const isAdmin = process.argv.includes("--admin");

if (!name || !email || !password) {
  console.error('Usage: node scripts/create-user.mjs "Name" email password [--admin]');
  process.exit(1);
}
if (password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

// Minimal schema guards — full migrations run inside the app on boot.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'Viewer',
    joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (workspace_id, user_id)
  );
`);

const existing = db.prepare("SELECT id FROM users WHERE lower(email) = lower(?)").get(email);
let userId;
if (existing) {
  userId = existing.id;
  db.prepare("UPDATE users SET name = ?, password_hash = ? WHERE id = ?").run(name, hashPassword(password), userId);
  console.log(`Updated existing user ${userId} (${email})`);
} else {
  userId = "user_" + randomBytes(6).toString("hex");
  db.prepare("INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)").run(
    userId,
    name,
    email,
    hashPassword(password)
  );
  console.log(`Created user ${userId} (${email})`);
}

if (isAdmin) {
  const ws = db.prepare("SELECT id FROM workspaces ORDER BY (id = 'ws_default') DESC LIMIT 1").get();
  if (ws) {
    db.prepare(
      "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'Admin') ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'Admin'"
    ).run(ws.id, userId);
    console.log(`Granted Admin role in workspace ${ws.id}`);
  } else {
    console.warn("No workspace found — run the app first, then re-run with --admin.");
  }
}
db.close();
