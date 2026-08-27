import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";
import { databaseUrl, supabaseServiceKey, supabaseUrl } from "./config";

declare global {
  var __crispSupabase: SupabaseClient | undefined;
  var __crispPg: pg.Pool | undefined;
}

/**
 * Supabase client. Used for Storage (file uploads/downloads/removal). The
 * service-role key bypasses Row Level Security; this module is server-only and
 * never imported into client components. Returns null when Supabase is not
 * configured (local backend).
 */
export function getSupabase(): SupabaseClient | null {
  const url = supabaseUrl();
  const key = supabaseServiceKey();
  if (!url || !key) return null;
  if (!globalThis.__crispSupabase) {
    globalThis.__crispSupabase = createClient(url, key);
  }
  return globalThis.__crispSupabase;
}

/**
 * PostgreSQL connection pool for the relational + vector layer. Used by the
 * Supabase backend for raw SQL (transactions, pgvector, aggregations) that maps
 * cleanly onto the existing parameterized query surface.
 */
export function getPgPool(): pg.Pool | null {
  const url = databaseUrl();
  if (!url || storageIsLocal()) return null;
  if (!globalThis.__crispPg) {
    globalThis.__crispPg = new pg.Pool({ connectionString: url });
  }
  return globalThis.__crispPg;
}

import { storageBackend } from "./config";
function storageIsLocal(): boolean {
  return storageBackend() === "local";
}
