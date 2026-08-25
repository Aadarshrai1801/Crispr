import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthzError } from "./rbac";
import { ApprovalError } from "./corrections";
import { LlmNotConfiguredError } from "./llm";

/** Uniform error mapping for v2 API routes. */
export function apiError(err: unknown) {
  if (err instanceof AuthzError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof ApprovalError) {
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status: err.status }
    );
  }
  if (err instanceof LlmNotConfiguredError) {
    return NextResponse.json({ error: err.message }, { status: 503 });
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: "Invalid request", details: err.issues }, { status: 400 });
  }
  console.error("[api]", err);
  return NextResponse.json(
    { error: err instanceof Error ? err.message : "Request failed" },
    { status: 500 }
  );
}

export function json<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}
