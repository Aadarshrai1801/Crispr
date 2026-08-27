import { NextResponse } from "next/server";
import * as lancedb from "@lancedb/lancedb";
import { getDb, rawQueryOne } from "@/lib/db";
import { lanceDbDir, validateProductionEnv, storageBackend } from "@/lib/config";
import { getSupabase, getPgPool } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ComponentCheck {
  status: "ok" | "fail";
  error?: string;
}

export async function GET() {
  const components: Record<string, ComponentCheck> = {};
  const backend = storageBackend();

  try {
    validateProductionEnv();
    components.env = { status: "ok" };
  } catch (err) {
    components.env = { status: "fail", error: err instanceof Error ? err.message : String(err) };
  }

  if (backend === "supabase") {
    try {
      const pool = getPgPool();
      if (!pool) throw new Error("Postgres pool unavailable");
      await pool.query("SELECT 1");
      const tables = await rawQueryOne<{ n: number }>(
        "SELECT count(*) AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'workspaces'"
      );
      if (!tables?.n) throw new Error("schema not initialized");
      components.postgres = { status: "ok" };
    } catch (err) {
      components.postgres = { status: "fail", error: err instanceof Error ? err.message : String(err) };
    }

    try {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase client unavailable");
      const { error } = await sb.storage.getBucket("documents");
      if (error) throw new Error(`Storage check failed: ${error.message}`);
      components.storage = { status: "ok" };
    } catch (err) {
      components.storage = { status: "fail", error: err instanceof Error ? err.message : String(err) };
    }
  } else {
    try {
      await getDb();
      await rawQueryOne("SELECT 1");
      const migrated = await rawQueryOne<{ n: number }>(
        "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='workspaces'"
      );
      if (!migrated?.n) throw new Error("schema not initialized");
      components.sqlite = { status: "ok" };
    } catch (err) {
      components.sqlite = { status: "fail", error: err instanceof Error ? err.message : String(err) };
    }

    try {
      await lancedb.connect(lanceDbDir()).then((c) => c.tableNames());
      components.lancedb = { status: "ok" };
    } catch (err) {
      components.lancedb = { status: "fail", error: err instanceof Error ? err.message : String(err) };
    }
  }

  const ok = Object.values(components).every((c) => c.status === "ok");
  return NextResponse.json(
    { status: ok ? "ready" : "unavailable", components, backend, timestamp: new Date().toISOString() },
    { status: ok ? 200 : 503 }
  );
}
