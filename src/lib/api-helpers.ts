import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthzError } from "./rbac";
import { ApprovalError } from "./corrections";
import { LlmNotConfiguredError } from "./llm";
import { logger } from "./logger";

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
  // Nice-to-have #1: full detail stays server-side; clients get a generic body.
  logger.error({ err }, "unhandled API route error");
  return NextResponse.json(
    { error: "Internal server error" },
    { status: 500 }
  );
}

export function json<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}
