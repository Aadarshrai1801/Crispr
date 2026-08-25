import { randomUUID } from "node:crypto";
import { config } from "./config";
import { embedOne } from "./embeddings";
import { generateGroundedAnswer, LlmNotConfiguredError } from "./llm";
import {
  defaultUserId,
  findCachedAnswer,
  getCorrection,
  getDocument,
  incrementCorrectionStats,
  insertQueryLog,
} from "./db";
import { computeGroundedness, normalizeQuestion } from "./utils";
import { searchChunks, searchCorrections } from "./vector";
import type { Citation, QueryLogRow, QueryResultPayload, SourceType } from "./types";

const NO_ANSWER_PHRASE = "cannot be answered from";

interface AnswerOptions {
  workspaceId: string;
  userId: string;
  documentIds: string[];
  question: string;
  /** Set for retries: escalates strategy instead of repeating an identical call (FR-18). */
  parentLog?: QueryLogRow;
}

export async function answerQuestion(opts: AnswerOptions): Promise<QueryResultPayload> {
  const { workspaceId, userId, documentIds, question } = opts;
  const isRetry = Boolean(opts.parentLog);
  const attempt = opts.parentLog ? opts.parentLog.attempt + 1 : 0;

  // ---- Cache identical fresh queries (cost control), never retries ----
  if (!isRetry) {
    const cached = findCachedAnswer(workspaceId, normalizeQuestion(question), documentIds);
    if (cached && Date.now() - new Date(cached.created_at).getTime() < 24 * 3600 * 1000) {
      return payloadFromLog(cached);
    }
  }

  const questionVector = await embedOne(question);

  // ---- 1. Corrections override layer, checked FIRST (FR-12, FR-22) ----
  const hits = await searchCorrections(questionVector, workspaceId, documentIds, config.correctionMatchThreshold);
  if (!isRetry && hits.length > 0) {
    const top = hits[0];
    const correction = getCorrection(top.id);
    if (correction && correction.status === "active") {
      incrementCorrectionStats(correction.id, "served_count");
      const queryLogId = "ql_" + randomUUID();
      insertQueryLog({
        id: queryLogId,
        workspace_id: workspaceId,
        user_id: userId,
        document_ids: documentIds,
        question_text: question,
        answer_text: correction.corrected_answer_text,
        source_type: "correction",
        citations: [],
        correction_id: correction.id,
        feedback_status: "none",
        retry_of: null,
        attempt: 0,
        strategy_note: `correction-match@${top.similarity.toFixed(3)}`,
      });
      // Confirmation loop: treat early serves against a new phrasing as a soft match
      // (PRD closing guidance) rather than a silent guess.
      const needsConfirmation = top.similarity < 0.945 && correction.served_count <= 3;
      return {
        query_log_id: queryLogId,
        question,
        answer: correction.corrected_answer_text,
        source_type: "correction",
        citations: [],
        groundedness: 100,
        correction: {
          id: correction.id,
          corrected_answer_text: correction.corrected_answer_text,
          wrong_answer_text: correction.wrong_answer_text,
          note: correction.note,
          submitted_by: correction.submitted_by,
          created_at: correction.created_at,
          similarity: top.similarity,
          needs_confirmation: needsConfirmation,
        },
        attempt: 0,
        strategy_note: "Served from correction layer",
      };
    }
  }

  // ---- 2. Standard retrieval over document chunks (FR-9..11) ----
  const topK = isRetry ? config.retryTopK : config.retrievalTopK;
  const chunks = await searchChunks(questionVector, documentIds, topK);

  const documents = documentIds.map((id) => getDocument(id)).filter((d): d is NonNullable<typeof d> => Boolean(d));
  const namesById = new Map(documents.map((d) => [d.id, d.filename]));

  const queryLogId = "ql_" + randomUUID();

  if (!chunks.length) {
    const message =
      "I could not find content in the uploaded document(s) that answers this question. Try rephrasing, or upload a document that covers this topic.";
    insertQueryLog({
      id: queryLogId,
      workspace_id: workspaceId,
      user_id: userId,
      document_ids: documentIds,
      question_text: question,
      answer_text: message,
      source_type: "no_answer",
      citations: [],
      feedback_status: "none",
      retry_of: opts.parentLog?.id ?? null,
      attempt,
      strategy_note: isRetry ? `retry-widened-topk=${topK}` : "fresh",
    });
    return {
      query_log_id: queryLogId,
      question,
      answer: message,
      source_type: "no_answer",
      citations: [],
      groundedness: 0,
      correction: null,
      attempt,
      strategy_note: "No matching chunks retrieved",
    };
  }

  const contexts = chunks.map(
    (c, i) =>
      `${i + 1}. Source: ${namesById.get(c.document_id) ?? c.document_id}, page ${c.page_number}${
        c.section_label ? `, section "${c.section_label}"` : ""
      }\n${c.text}`
  );

  let answerText: string;
  try {
    answerText = await generateGroundedAnswer({
      question,
      contexts,
      strict: isRetry,
      documentNames: documents.map((d) => d.filename),
    });
  } catch (err) {
    if (err instanceof LlmNotConfiguredError) throw err;
    throw new Error(`Generation failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const isNoAnswer = answerText.toLowerCase().includes(NO_ANSWER_PHRASE);

  // Parse [n] markers -> concrete citations
  const usedIndices = new Set<number>();
  for (const m of answerText.matchAll(/\[(\d+)\]/g)) {
    const idx = Number(m[1]);
    if (idx >= 1 && idx <= chunks.length) usedIndices.add(idx - 1);
  }
  const seen = new Set<string>();
  const citations: Citation[] = [];
  for (const idx of usedIndices) {
    const c = chunks[idx];
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    citations.push({
      document_id: c.document_id,
      document_name: namesById.get(c.document_id),
      page: c.page_number,
      section_label: c.section_label || null,
      chunk_id: c.id,
    });
  }

  const sourceType: SourceType = isNoAnswer ? "no_answer" : "document";
  const groundedness = isNoAnswer ? 0 : computeGroundedness(answerText, [...usedIndices].map((i) => i + 1));

  insertQueryLog({
    id: queryLogId,
    workspace_id: workspaceId,
    user_id: userId,
    document_ids: documentIds,
    question_text: question,
    answer_text: answerText,
    source_type: sourceType,
    citations,
    feedback_status: "none",
    retry_of: opts.parentLog?.id ?? null,
    attempt,
    strategy_note: isRetry ? `retry-topk=${topK}+strict-grounding` : `vector-topk=${topK}`,
  });

  return {
    query_log_id: queryLogId,
    question,
    answer: answerText,
    source_type: sourceType,
    citations,
    groundedness,
    correction: null,
    attempt,
    strategy_note: isRetry ? `Retry with wider retrieval (top-k=${topK}) + stricter grounding` : "Fresh retrieval",
  };
}

function payloadFromLog(log: QueryLogRow): QueryResultPayload {
  // Preserve correction provenance when re-serving a cached correction answer (FR-23)
  let correctionMeta: QueryResultPayload["correction"] = null;
  if (log.source_type === "correction" && log.correction_id) {
    const c = getCorrection(log.correction_id);
    if (c && c.status === "active") {
      correctionMeta = {
        id: c.id,
        corrected_answer_text: c.corrected_answer_text,
        wrong_answer_text: c.wrong_answer_text,
        note: c.note,
        submitted_by: c.submitted_by,
        created_at: c.created_at,
        similarity: 1,
        needs_confirmation: false,
      };
    }
  }
  return {
    query_log_id: log.id,
    question: log.question_text,
    answer: log.answer_text,
    source_type: log.source_type,
    citations: JSON.parse(log.citations) as Citation[],
    groundedness: log.source_type === "correction" ? 100 : -1,
    correction: correctionMeta,
    attempt: log.attempt,
    strategy_note: "Cached identical query",
  };
}

/** Fetches the document-derived answer for a correction-served response (FR-24 transparency toggle). */
export async function originalDocumentAnswer(workspaceId: string, documentIds: string[], question: string): Promise<QueryResultPayload> {
  const vector = await embedOne(question);
  const chunks = await searchChunks(vector, documentIds, config.retrievalTopK);
  const documents = documentIds.map((id) => getDocument(id)).filter((d): d is NonNullable<typeof d> => Boolean(d));
  const namesById = new Map(documents.map((d) => [d.id, d.filename]));

  if (!chunks.length) {
    return {
      query_log_id: "",
      question,
      answer: "The uploaded document(s) do not contain content matching this question.",
      source_type: "no_answer",
      citations: [],
      groundedness: 0,
      correction: null,
      attempt: 0,
      strategy_note: "Original document answer (on-demand)",
    };
  }

  const contexts = chunks.map(
    (c, i) =>
      `${i + 1}. Source: ${namesById.get(c.document_id) ?? c.document_id}, page ${c.page_number}${
        c.section_label ? `, section "${c.section_label}"` : ""
      }\n${c.text}`
  );

  const answerText = await generateGroundedAnswer({
    question,
    contexts,
    documentNames: documents.map((d) => d.filename),
  });
  const usedIndices = new Set<number>();
  for (const m of answerText.matchAll(/\[(\d+)\]/g)) {
    const idx = Number(m[1]);
    if (idx >= 1 && idx <= chunks.length) usedIndices.add(idx - 1);
  }
  const citations: Citation[] = [];
  const seen = new Set<string>();
  for (const idx of usedIndices) {
    const c = chunks[idx];
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    citations.push({
      document_id: c.document_id,
      document_name: namesById.get(c.document_id),
      page: c.page_number,
      section_label: c.section_label || null,
      chunk_id: c.id,
    });
  }
  void workspaceId;
  return {
    query_log_id: "",
    question,
    answer: answerText,
    source_type: "document",
    citations,
    groundedness: computeGroundedness(answerText, [...usedIndices].map((i) => i + 1)),
    correction: null,
    attempt: 0,
    strategy_note: "Original document answer (on-demand)",
  };
}
