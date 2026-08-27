import { readFile as fsRead, writeFile as fsWrite, unlink as fsUnlink, copyFile as fsCopy, mkdir } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { config, fileBucket, storageBackend } from "./config";
import { getSupabase } from "./supabase";

/**
 * File storage abstraction. In `local` mode files live under DATA_DIR/uploads
 * (the historical behavior). In `supabase` mode they live in Supabase Storage
 * under the configured bucket, addressed by an object key.
 *
 * `storage_path` values written to the DB are either absolute local paths
 * (local mode) or object keys (supabase mode). Callers only ever pass the value
 * through; this module interprets it.
 */

function isSupabase(): boolean {
  return storageBackend() === "supabase";
}

function keyFor(pathOrKey: string): string {
  // Local absolute paths look like <dataDir>/uploads/<...>; map them to a
  // relative object key for the bucket.
  return pathOrKey.replace(/^[\\/]+/, "").split(path.sep).join("/");
}

function localPathForKey(pathOrKey: string): string {
  return path.isAbsolute(pathOrKey) ? pathOrKey : path.join(config.dataDir, pathOrKey);
}

async function ensureBucket(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const bucket = fileBucket();
  const { data, error } = await sb.storage.getBucket(bucket);
  if (error || !data) {
    await sb.storage.createBucket(bucket, { public: false });
  }
}

export async function initStorage(): Promise<void> {
  if (!isSupabase()) return;
  await mkdir(uploadsLocalRoot(), { recursive: true }).catch(() => undefined);
  await ensureBucket();
}

export function uploadsLocalRoot(): string {
  return path.join(config.dataDir, "uploads");
}

/** Write a file to storage; returns the storage_path to persist on the row. */
export async function writeFileBytes(storagePath: string, data: Buffer): Promise<string> {
  if (isSupabase()) {
    const sb = getSupabase();
    if (sb) {
      await ensureBucket();
      const key = keyFor(storagePath);
      const { error } = await sb.storage.from(fileBucket()).upload(key, data, { upsert: true });
      if (error) throw new Error(`Storage upload failed: ${error.message}`);
      return key;
    }
  }
  const p = localPathForKey(storagePath);
  await mkdir(path.dirname(p), { recursive: true });
  await fsWrite(p, data);
  return p;
}

/** Read a file from storage as a Buffer. */
export async function readFileBytes(storagePath: string): Promise<Buffer> {
  if (isSupabase()) {
    const sb = getSupabase();
    if (sb) {
      const { data, error } = await sb.storage.from(fileBucket()).download(keyFor(storagePath));
      if (error || !data) throw new Error(`Storage download failed: ${error?.message ?? "no data"}`);
      const buf = Buffer.from(await data.arrayBuffer());
      return buf;
    }
  }
  return fsRead(localPathForKey(storagePath));
}

/** Copy a file between two storage locations (used for version archives). */
export async function copyFileBytes(fromPath: string, toPath: string): Promise<void> {
  if (isSupabase()) {
    const sb = getSupabase();
    const data = await readFileBytes(fromPath);
    if (sb) {
      await ensureBucket();
      const { error } = await sb.storage.from(fileBucket()).upload(keyFor(toPath), data, { upsert: true });
      if (error) throw new Error(`Storage copy failed: ${error.message}`);
      return;
    }
    // fall through to local write
    const p = localPathForKey(toPath);
    await mkdir(path.dirname(p), { recursive: true });
    await fsWrite(p, data);
    return;
  }
  const p = localPathForKey(toPath);
  await mkdir(path.dirname(p), { recursive: true });
  await fsCopy(localPathForKey(fromPath), p);
}

/** Delete a file; tolerant of a missing object. */
export async function deleteFileBytes(storagePath: string): Promise<void> {
  if (isSupabase()) {
    const sb = getSupabase();
    if (sb) {
      const { error } = await sb.storage.from(fileBucket()).remove([keyFor(storagePath)]);
      if (error && !/not found/i.test(error.message)) throw new Error(`Storage delete failed: ${error.message}`);
      return;
    }
  }
  await fsUnlink(localPathForKey(storagePath)).catch(() => undefined);
}

/** Synchronous existence helper for call paths that predate async. */
export function fileBytesExist(storagePath: string): boolean {
  return existsSync(localPathForKey(storagePath));
}

export { readFileSync };
