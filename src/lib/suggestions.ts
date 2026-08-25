import { config } from "./config";
import { embedOne, embed } from "./embeddings";
import { generateSuggestedAnswer, LlmNotConfiguredError } from "./llm";
import {
  findSimilarPendingSuggestion,
  getCorrection,
  getQueryLog,
  hasActiveCorrectionForQuestions,
  insertSuggestedCorrection,
  listFlaggedLogsSince,
} from "./db";

/**
 * Pillar E — compounding intelligence.
 *
 * FR-50: when a correction is approved on one document, check other documents in
 * the workspace for semantically similar passages and surface a "this may also
 * need correcting" suggestion to an Approver.
 *
 * FR-51: track flagged-but-uncorrected questions; when the same underlying
 * question is flagged 3+ times, proactively generate a suggested correction for
 * Approver review instead of waiting for someone to write it from scratch.
 */

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) dot += a[i] * b[i];
  return dot;
}

/* ------------------------------ FR-50 ------------------------------ */

export async function generateCrossDocSuggestions(correction: CorrectionLike): Promise<number> {
  if (!correction.document_id) return 0; // workspace-scope corrections already cover every doc
  const vector = await embedOne(correction.question_text);
  const matches = await searchChunksWorkspace(vector, correction.workspace_id, [correction.document_id], 6);

  // Own confidence gate before suggestions surface (PRD Risk #6).
  const strong = matches.filter((m) => m.score >= config.crossDocSuggestionSimilarity);
  if (!strong.length) return 0;

  // One suggestion per target document, best passage each.
  const byDoc = new Map<string, (typeof strong)[number]>();
  for (const m of strong) {
    if (!byDoc.has(m.document_id)) byDoc.set(m.document_id, m);
  }
  const top = [...byDoc.values()].slice(0, 3);

  let created = 0;
  for (const m of top) {
    const canonical = `${correction.question_text} [${m.document_id}]`;
    if (findSimilarPendingSuggestion(correction.workspace_id, canonical)) continue;
    insertSuggestedCorrection({
      workspace_id: correction.workspace_id,
      source_pattern: {
        type: "cross_doc",
        correction_id: correction.id,
        matches: [
          {
            document_id: m.document_id,
            chunk_id: m.id,
            page_number: m.page_number,
            text: m.text.slice(0, 600),
            similarity: Number(m.score.toFixed(4)),
          },
        ],
      },
      canonical_question: canonical,
      suggested_text: "",
      rationale: `A correction was just approved for a near-identical question. This similar passage in another document (${(m.score * 100).toFixed(0)}% match) may need the same fix.`,
    });
    created++;
  }
  return created;
}

// Structural subset of CorrectionRow used above (avoids import cycle noise).
interface CorrectionLike {
  id: string;
  workspace_id: string;
  document_id: string | null;
  question_text: string;
}

/* ------------------------------ FR-51 ------------------------------ */

export interface QuestionCluster {
  logs: Array<{ query_log_id: string; question_text: string; answer_text: string }>;
  centroid: number[];
}

/** Greedy centroid clustering over question embeddings. */
export async function clusterFlaggedQuestions(
  questions: Array<{ query_log_id: string; question_text: string; answer_text: string }>,
  similarityThreshold: number
): Promise<QuestionCluster[]> {
  if (!questions.length) return [];
  const vectors = await embed(questions.map((q) => q.question_text));
  const clusters: QuestionCluster[] = [];

  for (let i = 0; i < questions.length; i++) {
    const vec = vectors[i];
    let best: { cluster: QuestionCluster; sim: number } | null = null;
    for (const cluster of clusters) {
      const sim = cosine(cluster.centroid, vec);
      if (!best || sim > best.sim) best = { cluster, sim };
    }
    if (best && best.sim >= similarityThreshold) {
      const n = best.cluster.logs.length;
      best.cluster.centroid = best.cluster.centroid.map((v, j) => (v * n + vec[j]) / (n + 1));
      best.cluster.logs.push(questions[i]);
    } else {
      clusters.push({ centroid: [...vec], logs: [questions[i]] });
    }
  }
  return clusters;
}

export async function generateRepeatedFlagSuggestions(workspaceId: string): Promise<number> {
  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 19);
  const flagged = listFlaggedLogsSince(workspaceId, since);
  if (flagged.length < config.repeatedFlagClusterSize) return 0;

  const correctedQuestions = hasActiveCorrectionForQuestions(workspaceId);
  const candidates = flagged
    .filter((l) => !correctedQuestions.has(l.question_text.toLowerCase().trim()))
    .map((l) => ({ query_log_id: l.id, question_text: l.question_text, answer_text: l.answer_text }));

  const clusters = await clusterFlaggedQuestions(candidates, config.repeatedFlagClusterSimilarity);
  const bigClusters = clusters
    .filter((c) => c.logs.length >= config.repeatedFlagClusterSize)
    .sort((a, b) => b.logs.length - a.logs.length)
    .slice(0, 5);

  let created = 0;
  for (const cluster of bigClusters) {
    const canonicalLog = cluster.logs[0];
    const canonicalKey = `${workspaceId}:${canonicalLog.question_text.toLowerCase().trim()}`;
    if (findSimilarPendingSuggestion(workspaceId, canonicalKey)) continue;

    let suggestedText = "";
    let rationale = `This same question has been flagged ${cluster.logs.length} times without a persisted correction. Reviewing it once would stop the repeat flags.`;
    try {
      const vector = await embedOne(canonicalLog.question_text);
      const chunks = await searchChunksWorkspace(vector, workspaceId, [], 5);
      if (chunks.length) {
        const draft = await generateSuggestedAnswer(
          canonicalLog.question_text,
          chunks.map((c, i) => `${i + 1}. ${c.text}`)
        );
        if (draft && !draft.includes("INSUFFICIENT_CONTEXT")) suggestedText = draft;
      }
    } catch (err) {
      if (!(err instanceof LlmNotConfiguredError)) console.warn("[suggestions] synthesis failed:", err);
      rationale += " A drafted answer could not be auto-generated — please supply the correct answer.";
    }

    insertSuggestedCorrection({
      workspace_id: workspaceId,
      source_pattern: {
        type: "repeated_question",
        cluster: cluster.logs.slice(0, 10).map((l) => ({
          query_log_id: l.query_log_id,
          question_text: l.question_text,
          answer_text: l.answer_text,
        })),
      },
      canonical_question: canonicalKey,
      suggested_text: suggestedText,
      rationale,
    });
    created++;
  }
  return created;
}

/* ------------------------------ Accept / dismiss ------------------------------ */

export async function acceptSuggestion(
  suggestionId: string,
  actorId: string,
  overrides?: { corrected_answer?: string; document_id?: string | null }
) {
  const { getSuggestedCorrection } = await import("./db");
  const suggestion = getSuggestedCorrection(suggestionId);
  if (!suggestion) throw new Error("Suggestion not found");
  if (suggestion.status !== "pending") throw new Error(`Suggestion already ${suggestion.status}`);

  const pattern = JSON.parse(suggestion.source_pattern) as SuggestedPattern;
  const correctedText = overrides?.corrected_answer?.trim() || suggestion.suggested_text;
  if (!correctedText || correctedText.length < 2) {
    throw new Error("This suggestion has no draft answer — supply one when accepting.");
  }

  let originalQueryLogId: string;
  let wrongAnswer: string;
  let questionText: string;
  let documentId: string | null = null;

  if (pattern.type === "repeated_question") {
    const log = getQueryLog(pattern.cluster[0].query_log_id);
    if (!log) throw new Error("Original flagged query no longer exists");
    originalQueryLogId = log.id;
    wrongAnswer = log.answer_text;
    questionText = log.question_text;
    documentId = overrides?.document_id ?? (JSON.parse(log.document_ids)[0] as string | undefined) ?? null;
  } else {
    const source = getCorrection(pattern.correction_id);
    if (!source) throw new Error("Source correction no longer exists");
    originalQueryLogId = source.original_query_log_id;
    wrongAnswer = source.wrong_answer_text;
    questionText = source.question_text;
    documentId = overrides?.document_id ?? null;
  }

  const correction = await createCorrectionFromSuggestion({
    workspace_id: suggestion.workspace_id,
    document_id: documentId,
    original_query_log_id: originalQueryLogId,
    question_text: questionText,
    wrong_answer_text: wrongAnswer,
    corrected_answer_text: correctedText,
    note: "Created from a compounding-intelligence suggestion",
    submitted_by: actorId,
    suggested_correction_id: suggestion.id,
  });

  setSuggestedCorrectionStatus(suggestion.id, "accepted");
  return correction;
}

export async function dismissSuggestion(suggestionId: string, actorId: string) {
  const { getSuggestedCorrection, setSuggestedCorrectionStatus: setStatus } = await import("./db");
  const { audit } = await import("./audit");
  const suggestion = getSuggestedCorrection(suggestionId);
  if (!suggestion) throw new Error("Suggestion not found");
  setStatus(suggestionId, "dismissed");
  audit.write(suggestion.workspace_id, actorId, "suggestion.dismissed", "suggested_correction", suggestionId, { status: "pending" }, { status: "dismissed" });
}

type SuggestedPattern =
  | { type: "cross_doc"; correction_id: string; matches: unknown[] }
  | { type: "repeated_question"; cluster: Array<{ query_log_id: string }> };
