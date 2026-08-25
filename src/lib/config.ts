import path from "node:path";

function numEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolEnv(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  return raw !== "0" && raw.toLowerCase() !== "false";
}

export const config = {
  groqApiKey: process.env.GROQ_API_KEY ?? "",
  // gpt-oss-120b is the current strong default on Groq (llama-3.3-70b was retired).
  // Alternatives on most keys: openai/gpt-oss-20b (faster), qwen/qwen3.6-27b.
  groqModel: process.env.GROQ_MODEL ?? "openai/gpt-oss-120b",
  embeddingModel: process.env.EMBEDDING_MODEL ?? "Xenova/all-MiniLM-L6-v2",

  // Calibrated for all-MiniLM-L6-v2 (paraphrases land ~0.80-0.86; unrelated <0.4).
  // Raise toward 0.87+ if you swap in a stronger embedding model.
  correctionMatchThreshold: numEnv("CORRECTION_MATCH_THRESHOLD", 0.8),
  correctionConflictThreshold: numEnv("CORRECTION_CONFLICT_THRESHOLD", 0.9),
  retrievalTopK: numEnv("RETRIEVAL_TOP_K", 6),
  retryTopK: numEnv("RETRY_TOP_K", 14),
  maxRetries: numEnv("MAX_RETRIES", 2),

  chunkSize: numEnv("CHUNK_SIZE", 1200),
  chunkOverlap: numEnv("CHUNK_OVERLAP", 180),
  ocrMinChars: numEnv("OCR_MIN_CHARS", 32),
  enableOcr: boolEnv("ENABLE_OCR", true),

  dataDir: path.resolve(process.cwd(), process.env.DATA_DIR ?? "./data"),
} as const;

export const uploadsDir = () => path.join(config.dataDir, "uploads");
export const lanceDbDir = () => path.join(config.dataDir, "lancedb");
export const sqlitePath = () => path.join(config.dataDir, "crisp.db");
export const modelsCacheDir = () => path.join(config.dataDir, "models");
