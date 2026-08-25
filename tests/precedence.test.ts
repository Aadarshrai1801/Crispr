import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";

/**
 * Correction-layer precedence (blocker #6 coverage): a stored correction must
 * be served BEFORE retrieval/LLM; otherwise the grounded document path runs.
 * LLM + embeddings are mocked; SQLite and the (faked) vector store are real.
 */

const llmCalls: Array<{ question: string }> = [];
let correctionHits: Array<{ id: string; similarity: number }> = [];
const chunkText = "Q3 revenue was $4.2M according to the finance summary.";

vi.mock("@/lib/llm", () => {
  class LlmNotConfiguredError extends Error {
    constructor() {
      super("GROQ_API_KEY is not set.");
      this.name = "LlmNotConfiguredError";
    }
  }
  return {
    LlmNotConfiguredError,
    generateGroundedAnswer: vi.fn((req: { question: string }) => {
      llmCalls.push({ question: req.question });
      return Promise.resolve("[1] The answer is present in context.");
    }),
    generateConflictVerdicts: vi.fn(() => Promise.resolve([])),
    generateSuggestedAnswer: vi.fn(() => Promise.resolve("")),
  };
});

vi.mock("@/lib/embeddings", () => ({
  embedOne: vi.fn(() => Promise.resolve([0.5, 0.5, 0.5])),
  embed: vi.fn(() => Promise.resolve([[0.5, 0.5, 0.5]])),
}));

vi.mock("@/lib/vector", () => ({
  searchCorrections: vi.fn(() => Promise.resolve(correctionHits)),
  upsertCorrectionVectors: vi.fn(() => Promise.resolve()),
  removeCorrectionVector: vi.fn(() => Promise.resolve()),
  searchChunks: vi.fn(() =>
    Promise.resolve([
      {
        id: "chunk_" + randomUUID(),
        document_id: "",
        workspace_id: "",
        page_number: 1,
        section_label: "",
        text: chunkText,
        score: 0.9,
      },
    ])
  ),
  upsertChunkVectors: vi.fn(() => Promise.resolve()),
  deleteVectorsForDocument: vi.fn(() => Promise.resolve()),
}));

import { answerQuestion, resolveQueryScope } from "@/lib/retrieval";
import {
  defaultWorkspaceId,
  insertCorrection,
  insertDocument,
  insertQueryLog,
  getDb,
} from "@/lib/db";

function seedDoc(workspaceId: string): string {
  const docId = "doc_" + randomUUID();
  insertDocument({
    id: docId,
    workspace_id: workspaceId,
    owner_id: "user_test",
    filename: `finance-${randomUUID().slice(0, 6)}.pdf`,
    storage_path: "/unused",
    page_count: 3,
    status: "ready",
    file_hash: randomUUID(),
    ocr_warning: false,
    error: null,
  });
  return docId;
}

function makeQueryLog(workspaceId: string, question: string, documentIds: string[]) {
  const id = "ql_" + randomUUID();
  insertQueryLog({
    id,
    workspace_id: workspaceId,
    user_id: "user_test",
    document_ids: documentIds,
    question_text: question,
    answer_text: "wrong",
    source_type: "document",
    citations: [],
    correction_id: null,
    feedback_status: "flagged",
    retry_of: null,
    attempt: 0,
    strategy_note: "fresh",
    confidence_score: 0.4,
    confidence_threshold: 0.55,
    flagged_needs_review: true,
  });
  return id;
}

describe("correction-first precedence", () => {
  it("serves an active correction above threshold WITHOUT calling the LLM", async () => {
    const wsId = defaultWorkspaceId();
    const docId = seedDoc(wsId);
    const q = `Unique precedence question ${randomUUID()}`;
    const logId = makeQueryLog(wsId, q, [docId]);

    const correction = insertCorrection({
      workspace_id: wsId,
      document_id: docId,
      original_query_log_id: logId,
      question_text: q,
      topic_tags: [],
      wrong_answer_text: "wrong",
      corrected_answer_text: "The corrected revenue figure is $4.2M.",
      note: null,
      submitted_by: "user_test",
      status: "active",
      supersedes_correction_id: null,
      scope: "document",
      suggested_correction_id: null,
    });

    correctionHits = [{ id: correction.id, similarity: 0.95 }];
    const before = getDb().prepare("SELECT served_count FROM corrections WHERE id = ?").get(correction.id) as {
      served_count: number;
    };

    const result = await answerQuestion({ workspaceId: wsId, userId: "user_test", documentIds: [docId], question: q });

    expect(result.source_type).toBe("correction");
    expect(result.answer).toBe("The corrected revenue figure is $4.2M.");
    expect(result.correction?.id).toBe(correction.id);
    expect(llmCalls).toHaveLength(0); // precedence: no generation happened
    const after = getDb().prepare("SELECT served_count FROM corrections WHERE id = ?").get(correction.id) as {
      served_count: number;
    };
    expect(after.served_count).toBe(before.served_count + 1);
  });

  it("falls through to grounded retrieval when no correction matches", async () => {
    const wsId = defaultWorkspaceId();
    const docId = seedDoc(wsId);
    const q = `No-correction match ${randomUUID()}`;

    correctionHits = []; // nothing in the override layer matches
    llmCalls.length = 0;

    const result = await answerQuestion({
      workspaceId: wsId,
      userId: "user_test",
      documentIds: [docId],
      question: q,
    });

    expect(result.source_type).toBe("document");
    expect(result.citations.length).toBeGreaterThan(0);
    expect(llmCalls).toHaveLength(1); // generation ran this time
  });

  it("pending corrections never override retrieval", async () => {
    const wsId = defaultWorkspaceId();
    const docId = seedDoc(wsId);
    const q = `Pending invisible ${randomUUID()}`;
    const logId = makeQueryLog(wsId, q, [docId]);

    const pending = insertCorrection({
      workspace_id: wsId,
      document_id: docId,
      original_query_log_id: logId,
      question_text: q,
      topic_tags: [],
      wrong_answer_text: "wrong",
      corrected_answer_text: "PENDING MUST NOT SERVE",
      note: null,
      submitted_by: "user_test",
      status: "pending",
      supersedes_correction_id: null,
      scope: "document",
      suggested_correction_id: null,
    });

    // Even if a stale vector index entry existed, the status guard blocks it.
    correctionHits = [{ id: pending.id, similarity: 0.99 }];
    llmCalls.length = 0;

    const result = await answerQuestion({ workspaceId: wsId, userId: "user_test", documentIds: [docId], question: q });

    expect(result.answer).not.toContain("PENDING MUST NOT SERVE");
    expect(result.source_type).toBe("document");
    expect(llmCalls).toHaveLength(1);
  });
});

describe("workspace-wide query narrowing (FR-37)", () => {
  it("keeps <=50 docs untouched", async () => {
    const wsId = defaultWorkspaceId();
    const ids = Array.from({ length: 10 }, () => seedDoc(wsId));
    const scope = resolveQueryScope(ids, wsId);
    expect(scope.narrowed).toBe(false);
    expect(scope.documentIds).toHaveLength(10);
  });

  it("narrows beyond 50 docs instead of timing out", async () => {
    const wsId = defaultWorkspaceId();
    const ids = Array.from({ length: 60 }, () => seedDoc(wsId));
    const scope = resolveQueryScope(ids, wsId);
    expect(scope.narrowed).toBe(true);
    expect(scope.documentIds).toHaveLength(50);
    // Kept documents must all be ready ones from this workspace.
    for (const id of scope.documentIds) expect(ids).toContain(id);
  });
});
