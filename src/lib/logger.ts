import { pino } from "pino";
import { isProdRuntime } from "./config";

/**
 * Structured logging (nice-to-have #7). JSON output with levels; secrets and
 * credential-shaped fields are redacted centrally. Request paths log through
 * apiError(); background pipelines log here too so failures never vanish into
 * bare console output.
 *
 * Sensitive-data policy (audit item N9): full Q&A text lives in query_logs
 * (DB, not logs); webhook endpoint URLs are never logged — only the event name
 * and outcome.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProdRuntime() ? "info" : "debug"),
  redact: {
    paths: [
      "password",
      "*.password",
      "token",
      "*.token",
      "authorization",
      "*.apiKey",
      "apiKey",
      "secret",
      "*.secret",
      "req.headers.cookie",
      "req.headers.authorization",
    ],
    censor: "[redacted]",
  },
});
