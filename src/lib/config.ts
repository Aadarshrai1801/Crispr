import path from "node:path";

/**
 * Known insecure fallback used only in local development. Production boot fails
 * fast if the real secret is unset or still matches this value.
 */
export const DEV_ENCRYPTION_FALLBACK = "crispr-local-dev-encryption-secret";

/** True when running the actual production server (not `next build`). */
export function isProdRuntime(): boolean {
  return (
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  );
}

/**
 * Blocker #5: refuse to boot the production server with insecure defaults.
 * Called from createDb() (i.e. on first runtime DB access) and by /api/ready,
 * and skipped during the build phase where NODE_ENV is already "production".
 */
export function validateProductionEnv(): void {
  if (!isProdRuntime()) return;
  const failures: string[] = [];
  const secret = process.env.CRISPR_ENCRYPTION_SECRET;
  if (!secret || secret === DEV_ENCRYPTION_FALLBACK) {
    failures.push(
      "CRISPR_ENCRYPTION_SECRET is unset or still set to the development fallback. Generate one with: node -e \"console.log(require('node:crypto').randomBytes(32).toString('base64url'))\""
    );
  }
  if (failures.length) {
    throw new Error(
      `Refusing to start in production mode:\n  - ${failures.join("\n  - ")}`
    );
  }
}

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

  /* ---- v2 ---- */
  // Default answer-confidence threshold; overridable per workspace (FR-42).
  confidenceThreshold: numEnv("CONFIDENCE_THRESHOLD", 0.55),
  // Similarity above which two passages in different documents are conflict candidates (FR-43).
  conflictCandidateSimilarity: numEnv("CONFLICT_CANDIDATE_SIMILARITY", 0.86),
  // Max chunks examined per workspace conflict scan (pairwise cost guard).
  conflictScanMaxChunks: numEnv("CONFLICT_SCAN_MAX_CHUNKS", 1200),
  // Cross-document "may also need correcting" suggestion similarity (FR-50).
  crossDocSuggestionSimilarity: numEnv("CROSS_DOC_SUGGESTION_SIMILARITY", 0.72),
  // Repeated flagged questions needed before a suggested correction is generated (FR-51).
  repeatedFlagClusterSize: numEnv("REPEATED_FLAG_CLUSTER_SIZE", 3),
  repeatedFlagClusterSimilarity: numEnv("REPEATED_FLAG_CLUSTER_SIMILARITY", 0.82),
  webhookTimeoutMs: numEnv("WEBHOOK_TIMEOUT_MS", 5000),
  // Secret used to encrypt integration credentials at rest (AES-256-GCM). Set in production!
  // Dev fallback only — validateProductionEnv() hard-fails a production boot that relies on it.
  encryptionSecret: process.env.CRISPR_ENCRYPTION_SECRET ?? DEV_ENCRYPTION_FALLBACK,
  // Slack/Teams bot wiring (optional; used by /api/integrations/slack/events).
  slackSigningSecret: process.env.SLACK_SIGNING_SECRET ?? "",
  slackDefaultWorkspaceId: process.env.SLACK_DEFAULT_WORKSPACE_ID ?? "",
} as const;

/** Per-workspace soft/hard caps from the PRD scalability table + packaging gates. */
export const tierCaps = {
  free: { documents: 3, members: 1 },
  pro: { documents: Infinity, members: 1 },
  team: { documents: 2000, members: 25 },
  enterprise: { documents: 50000, members: 500 },
} as const;

/** Features gated to specific minimum tiers (PRD pricing table). */
export const tierFeatures = {
  apiKeys: ["enterprise"] as const,
  confluenceSharepoint: ["enterprise"] as const,
  publicApi: ["enterprise"] as const,
};

export const uploadsDir = () => path.join(config.dataDir, "uploads");
export const lanceDbDir = () => path.join(config.dataDir, "lancedb");
export const sqlitePath = () => path.join(config.dataDir, "crisp.db");
export const modelsCacheDir = () => path.join(config.dataDir, "models");
