import { NextResponse } from "next/server";
import * as lancedb from "@lancedb/lancedb";
import { getDb, rawQueryOne } from "@/lib/db";
import { lanceDbDir, validateProductionEnv } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ComponentCheck {
  status: "ok" | "fail";
  error?: string;
}

/**
 * Readiness probe: verifies SQLite is reachable and migrated, LanceDB opens,
 * and production env validation passes. Returns 503 with per-component detail
 * on any failure so orchestrators can hold traffic.
 */
export async function GET() {
  const components: Record<string, ComponentCheck> = {};

  try {
    validateProductionEnv();
    components.env = { status: "ok" };
  } catch (err) {
    components.env = { status: "fail", error: err instanceof Error ? err.message : String(err) };
  }

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

  const ok = Object.values(components).every((c) => c.status === "ok");
  return NextResponse.json(
    { status: ok ? "ready" : "unavailable", components, timestamp: new Date().toISOString() },
    { status: ok ? 200 : 503 }
  );
}
