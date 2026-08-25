import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";

/**
 * Approval workflow state machine (FR-33 / blocker #6 coverage).
 * Vector store + embeddings are faked so tests run fully offline; SQLite,
 * audit log, and webhook dispatch run for real against a temp DATA_DIR
 * (see tests/setup.ts).
 */

const indexCalls: { upserts: string[]; removals: string[] } = { upserts: [], removals: [] };
let correctionHits: Array<{ id: string; similarity: number }> = [];

vi.mock("@/lib/vector", async () => {
  const actualType = await vi.importActual<typeof import("@/lib/types")>("@/lib/types");
  void actualType;
  return {
    searchCorrections: vi.fn(() => Promise.resolve(correctionHits)),
    upsertCorrectionVectors: vi.fn((rows: Array<{ id: string }>) => {
      indexCalls.upserts.push(...rows.map((r) => r.id));
      return Promise.resolve();
    }),
    removeCorrectionVector: vi.fn((id: string) => {
      indexCalls.removals.push(id);
      return Promise.resolve();
    }),
    searchChunks: vi.fn(() => Promise.resolve([])),
    upsertChunkVectors: vi.fn(() => Promise.resolve()),
    deleteVectorsForDocument: vi.fn(() => Promise.resolve()),
  };
});

vi.mock("@/lib/embeddings", () => ({
  embedOne: vi.fn(() => Promise.resolve([0.1, 0.2, 0.3])),
  embed: vi.fn(() => Promise.resolve([[0.1, 0.2, 0.3]])),
}));

import {
  submitCorrection,
  approveCorrection,
  rejectCorrection,
  ApprovalError,
} from "@/lib/corrections";
import {
  defaultWorkspaceId,
  getCorrection,
  getWorkspace,
  insertQueryLog,
  insertWorkspace,
  updateWorkspaceSettings,
} from "@/lib/db";

function makeQueryLog(workspaceId: string, question: string) {
  const id = "ql_" + randomUUID();
  const docId = "doc_" + randomUUID();
  insertQueryLog({
    id,
    workspace_id: workspaceId,
    user_id: "user_test",
    document_ids: [docId],
    question_text: question,
    answer_text: "The original (wrong) answer",
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

beforeEach(() => {
  indexCalls.upserts = [];
  indexCalls.removals = [];
  correctionHits = [];
});

describe("approval state machine", () => {
  it("submits as pending in an approval-required workspace and never touches the index", async () => {
    const ws = insertWorkspace({ name: "Approval WS " + randomUUID(), owner_id: "user_admin", approval_required: true });
    const logId = makeQueryLog(ws.id, "What is the refund window?");

    const result = await submitCorrection({ query_log_id: logId, corrected_answer: "14 days." });
    expect(result.conflictWith).toBeNull();
    expect(result.correction.status).toBe("pending");
    // Pending corrections must NEVER enter the retrieval override layer.
    expect(indexCalls.upserts).toHaveLength(0);
  });

  it("approve: pending -> active, records approver and syncs the override index", async () => {
    const ws = insertWorkspace({ name: "Approve WS " + randomUUID(), owner_id: "user_admin", approval_required: true });
    const logId = makeQueryLog(ws.id, "How long is onboarding?");
    const submitted = await submitCorrection({ query_log_id: logId, corrected_answer: "Two weeks." });

    const approved = await approveCorrection(submitted.correction.id, "user_approver");
    expect(approved.status).toBe("active");
    expect(approved.approved_by).toBe("user_approver");
    expect(indexCalls.upserts).toContain(submitted.correction.id);
  });

  it("rejects approving a non-pending correction", async () => {
    const ws = insertWorkspace({ name: "Twice WS " + randomUUID(), owner_id: "user_admin", approval_required: true });
    const logId = makeQueryLog(ws.id, "Duplicate approval?");
    const c = await submitCorrection({ query_log_id: logId, corrected_answer: "Yes." });
    await approveCorrection(c.correction.id, "user_approver");

    await expect(approveCorrection(c.correction.id, "user_approver")).rejects.toMatchObject({
      name: "ApprovalError",
      status: 409,
    });
  });

  it("reject flow stores a mandatory reason and locks further approvals", async () => {
    const ws = insertWorkspace({ name: "Reject WS " + randomUUID(), owner_id: "user_admin", approval_required: true });
    const logId = makeQueryLog(ws.id, "Reject me?");
    const c = await submitCorrection({ query_log_id: logId, corrected_answer: "Wrong fix." });

    const rejected = await rejectCorrection(c.correction.id, "user_approver", "Does not match the source.");
    expect(rejected.status).toBe("rejected");
    expect(rejected.rejection_reason).toBe("Does not match the source.");
    expect(indexCalls.upserts).not.toContain(c.correction.id);

    await expect(approveCorrection(c.correction.id, "user_approver")).rejects.toBeInstanceOf(ApprovalError);
    await expect(rejectCorrection(c.correction.id, "user_approver", "again")).rejects.toMatchObject({ status: 409 });
  });

  it("404s for unknown correction ids", async () => {
    await expect(approveCorrection("corrections_no_such_id", "x")).rejects.toMatchObject({ status: 404 });
    await expect(rejectCorrection("corrections_no_such_id", "x", "why")).rejects.toMatchObject({ status: 404 });
  });

  it("first-approved-wins: near-duplicate approval requires explicit supersede", async () => {
    const ws = insertWorkspace({ name: "Supersede WS " + randomUUID(), owner_id: "user_admin", approval_required: true });
    const q = "What was Q3 revenue?";
    const logA = makeQueryLog(ws.id, q);
    const logB = makeQueryLog(ws.id, q);

    const a = (await submitCorrection({ query_log_id: logA, corrected_answer: "$4.2M" })).correction;
    const b = (await submitCorrection({ query_log_id: logB, corrected_answer: "$4.3M" })).correction;

    await approveCorrection(a.id, "user_approver");

    // Second approval collides with the now-active near-duplicate...
    correctionHits = [{ id: a.id, similarity: 0.97 }];
    await expect(approveCorrection(b.id, "user_approver")).rejects.toMatchObject({
      status: 409,
      code: "conflicting_active",
    });

    // ...and only goes through with an explicit supersede decision.
    const winner = await approveCorrection(b.id, "user_approver", { supersedeExisting: true });
    expect(winner.status).toBe("active");
    expect(getCorrection(a.id)?.status).toBe("superseded");
    // Superseded correction leaves the override layer.
    expect(indexCalls.removals).toContain(a.id);
    expect(indexCalls.upserts).toContain(b.id);
  });

  it("rejected corrections are retained with their reason but never go live", async () => {
    const ws = insertWorkspace({ name: "Retain WS " + randomUUID(), owner_id: "user_admin", approval_required: true });
    const logId = makeQueryLog(ws.id, "Retention check?");
    const c = await submitCorrection({ query_log_id: logId, corrected_answer: "Nope." });
    await rejectCorrection(c.correction.id, "user_approver", "Incorrect reading.");

    const stillThere = getCorrection(c.correction.id);
    expect(stillThere).toBeDefined();
    expect(stillThere?.status).toBe("rejected");
    expect(stillThere?.rejection_reason).toBeTruthy();
    expect(indexCalls.upserts).not.toContain(c.correction.id);
  });

  it("approval-mode-off workspaces publish immediately (classic v1 behavior)", async () => {
    const wsId = defaultWorkspaceId(); // seeded without approvals
    if (getWorkspace(wsId)?.approval_required) {
      updateWorkspaceSettings(wsId, { approval_required: false });
    }
    const logId = makeQueryLog(wsId, "Instant publish?");
    const result = await submitCorrection({ query_log_id: logId, corrected_answer: "Immediately live." });
    expect(result.correction.status).toBe("active");
    expect(indexCalls.upserts).toContain(result.correction.id);
  });
});
