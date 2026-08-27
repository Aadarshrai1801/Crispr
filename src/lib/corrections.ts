import { embedOne } from "./embeddings";
import { config } from "./config";
import {
  getCorrection,
  getQueryLog,
  insertCorrection,
  listActiveCorrectionsForDocs,
  setCorrectionStatus,
  setPendingEdit,
  updateCorrectionText,
  updateCorrectionScope,
  getWorkspace,
  listPendingCorrections,
  type PendingEditPayload,
} from "./db";
import { removeCorrectionVector, searchCorrections, upsertCorrectionVectors } from "./vector";
import { audit } from "./audit";
import { dispatchWebhook } from "./webhooks";
import type { CorrectionRow, WorkspaceRole } from "./types";

export interface SubmitCorrectionInput {
  query_log_id: string;
  corrected_answer: string;
  note?: string | null;
  scope?: "document" | "workspace";
  topic_tags?: string[];
  /** Conflict resolution action when a similar ACTIVE correction already exists. */
  resolve?: "replace" | "annotate" | "keep";
  /** Acting user (defaults to the query log's user). */
  actor_id?: string;
  /** Role of the acting user — Admin/Approver submissions skip the approval gate. */
  submitter_role?: WorkspaceRole | null;
  /** When accepting a system-generated suggestion (FR-51). */
  suggested_correction_id?: string | null;
}

export interface SubmitCorrectionResult {
  correction: CorrectionRow;
  conflictWith: CorrectionRow | null;
}

/**
 * The correction index embeds the bare question text. Topic tags are metadata for
 * display/future recall widening — mixing them into the vector dilutes similarity
 * against plain paraphrases (measured ~0.02 drop).
 */
function indexText(question: string): string {
  return question;
}

async function syncIndexRow(correction: CorrectionRow) {
  const vector = await embedOne(indexText(correction.question_text));
  await removeCorrectionVector(correction.id);
  await upsertCorrectionVectors([
    {
      id: correction.id,
      workspace_id: correction.workspace_id,
      document_id: correction.document_id ?? "",
      scope: correction.scope,
      vector,
    },
  ]);
}

async function removeFromIndex(id: string) {
  await removeCorrectionVector(id).catch(() => undefined);
}

/** Only live (active) corrections enter the override layer — pending never affects retrieval (FR-33). */
function isLive(correction: CorrectionRow): boolean {
  return correction.status === "active";
}

export async function detectConflict(workspaceId: string, documentIds: string[], questionText: string): Promise<CorrectionRow | null> {
  const vector = await embedOne(questionText);
  const hits = await searchCorrections(vector, workspaceId, documentIds, config.correctionConflictThreshold);
  for (const hit of hits) {
    const existing = await getCorrection(hit.id);
    if (existing && isLive(existing)) return existing;
  }
  return null;
}

/**
 * FR-32/FR-33 submission path, role-gated: fixes by Admins/Approvers go live
 * immediately; every other member's correction enters `pending` and stays
 * invisible to retrieval (and to other users) until an Approver/Admin approves.
 */
export async function submitCorrection(input: SubmitCorrectionInput): Promise<SubmitCorrectionResult> {
  const log = await getQueryLog(input.query_log_id);
  if (!log) throw new Error("Original query log not found");

  const actorId = input.actor_id ?? log.user_id;
  const workspace = await getWorkspace(log.workspace_id);

  const documentIds = JSON.parse(log.document_ids) as string[];
  const scope = input.scope ?? (documentIds.length === 1 ? "document" : "workspace");
  const documentId = scope === "document" ? (documentIds[0] ?? null) : null;

  // FR-28: surface conflicts rather than silently overwriting
  const conflictWith =
    input.resolve === undefined ? await detectConflict(log.workspace_id, documentIds, log.question_text) : null;

  if (conflictWith && input.resolve !== "annotate") {
    return { correction: conflictWith, conflictWith };
  }

  let supersedesId: string | null = null;
  if (input.resolve === "replace") {
    const existing = await detectConflict(log.workspace_id, documentIds, log.question_text);
    if (existing) {
      await setCorrectionStatus(existing.id, "superseded");
      await removeFromIndex(existing.id);
      supersedesId = existing.id;
      await audit.write(log.workspace_id, actorId, "correction.edited", "correction", existing.id, { status: existing.status }, { status: "superseded", replaced_by_intent: true });
    }
  }

  const status: CorrectionRow["status"] = workspace?.approval_required
    ? canApprove(input.submitter_role)
      ? "active"
      : "pending"
    : "active";

  const correction = await insertCorrection({
    workspace_id: log.workspace_id,
    document_id: documentId,
    original_query_log_id: log.id,
    question_text: log.question_text,
    topic_tags: input.topic_tags ?? [],
    wrong_answer_text: log.answer_text,
    corrected_answer_text: input.corrected_answer,
    note: input.note ?? null,
    submitted_by: actorId,
    supersedes_correction_id: supersedesId,
    scope,
    status,
    suggested_correction_id: input.suggested_correction_id ?? null,
  });

  // Only live corrections join the vector override layer.
  if (isLive(correction)) {
    await syncIndexRow(correction);
  }

  await audit.write(
    log.workspace_id,
    actorId,
    "correction.submitted",
    "correction",
    correction.id,
    null,
    { status, question: correction.question_text, corrected_answer: correction.corrected_answer_text, scope, document_id: documentId }
  );

  await dispatchWebhook("correction.submitted", log.workspace_id, {
    correction_id: correction.id,
    status,
    question: correction.question_text,
    submitted_by: actorId,
    requires_approval: status === "pending",
  });

  return { correction, conflictWith: null };
}

export class ApprovalError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status = 400, code?: string) {
    super(message);
    this.name = "ApprovalError";
    this.status = status;
    this.code = code;
  }
}

/**
 * FR-33 approve action (Approver/Admin enforced by the calling route).
 * Resolution order when a near-duplicate ACTIVE correction already exists
 * (PRD Risk #1 decision): FIRST-APPROVED-WINS — the new approval is blocked
 * until the approver explicitly chooses to supersede.
 */
export async function approveCorrection(id: string, approverId: string, opts?: { supersedeExisting?: boolean }): Promise<CorrectionRow> {
  const correction = await getCorrection(id);
  if (!correction) throw new ApprovalError("Correction not found", 404);
  if (correction.status !== "pending") throw new ApprovalError(`Only pending corrections can be approved (current: ${correction.status}).`, 409);

  const documentIds = correction.document_id ? [correction.document_id] : [];
  const conflictingActive = await detectConflict(correction.workspace_id, documentIds, correction.question_text);
  if (conflictingActive && conflictingActive.id !== id && !opts?.supersedeExisting) {
    throw new ApprovalError(
      `An active correction for a near-identical question already exists (${conflictingActive.id}). Approve with "supersede" to replace it.`,
      409,
      "conflicting_active"
    );
  }

  let supersededId: string | null = null;
  if (conflictingActive && conflictingActive.id !== id && opts?.supersedeExisting) {
    await setCorrectionStatus(conflictingActive.id, "superseded", id);
    await removeFromIndex(conflictingActive.id);
    supersededId = conflictingActive.id;
    await audit.write(correction.workspace_id, approverId, "correction.superseded", "correction", conflictingActive.id, { status: "active" }, { status: "superseded", superseded_by: id });
  }

  await setCorrectionStatus(id, "active", supersededId ?? undefined, { approved_by: approverId });
  const updated = (await getCorrection(id))!;
  await syncIndexRow(updated); // enters the override layer for ALL workspace members instantly (FR-32)

  await audit.write(correction.workspace_id, approverId, "correction.approved", "correction", id, { status: "pending" }, {
    status: "active",
    approved_by: approverId,
    superseded: supersededId,
  });

  await dispatchWebhook("correction.approved", correction.workspace_id, {
    correction_id: id,
    approved_by: approverId,
    question: updated.question_text,
  });

  return updated;
}

export async function rejectCorrection(id: string, rejectorId: string, reason: string): Promise<CorrectionRow> {
  const correction = await getCorrection(id);
  if (!correction) throw new ApprovalError("Correction not found", 404);
  if (correction.status !== "pending") throw new ApprovalError(`Only pending corrections can be rejected (current: ${correction.status}).`, 409);

  await setCorrectionStatus(id, "rejected", undefined, { rejection_reason: reason });
  const updated = (await getCorrection(id))!;
  await removeFromIndex(id);

  await audit.write(correction.workspace_id, rejectorId, "correction.rejected", "correction", id, { status: "pending" }, {
    status: "rejected",
    rejected_by: rejectorId,
    reason,
  });

  await dispatchWebhook("correction.rejected", correction.workspace_id, {
    correction_id: id,
    rejected_by: rejectorId,
    reason,
  });

  return updated;
}

export function canApprove(role: WorkspaceRole | null | undefined): boolean {
  return role === "Admin" || role === "Approver";
}

export async function pendingCount(workspaceId: string): Promise<number> {
  return (await listPendingCorrections(workspaceId)).length;
}

export async function editCorrection(
  id: string,
  fields: { question_text?: string; corrected_answer_text?: string; note?: string | null; topic_tags?: string[]; scope?: "document" | "workspace"; document_id?: string | null; actor_id?: string }
): Promise<CorrectionRow> {
  const existing = await getCorrection(id);
  if (!existing) throw new Error("Correction not found");

  await updateCorrectionText(id, fields);
  if (fields.scope) await updateCorrectionScope(id, fields.scope, fields.scope === "workspace" ? null : (fields.document_id ?? existing.document_id));

  const updated = (await getCorrection(id))!;
  if (isLive(updated)) {
    await syncIndexRow(updated);
  }

  await audit.write(existing.workspace_id, fields.actor_id ?? existing.submitted_by, "correction.edited", "correction", id,
    { question_text: existing.question_text, corrected_answer_text: existing.corrected_answer_text, note: existing.note },
    { question_text: updated.question_text, corrected_answer_text: updated.corrected_answer_text, note: updated.note });
  return updated;
}

/**
 * Role-gated edit proposal (FR-33 spirit): edits from members without approval
 * authority are stored as a pending proposal on the live correction. The
 * original answer stays active and visible until an Approver/Admin accepts.
 */
export async function proposeCorrectionEdit(
  id: string,
  fields: PendingEditPayload,
  actorId: string
): Promise<CorrectionRow> {
  const existing = await getCorrection(id);
  if (!existing) throw new ApprovalError("Correction not found", 404);
  if (existing.status !== "active") {
    throw new ApprovalError(`Only active corrections can be edited (current: ${existing.status}).`, 409);
  }

  await setPendingEdit(id, fields, actorId);
  await audit.write(existing.workspace_id, actorId, "correction.edit_proposed", "correction", id,
    { question_text: existing.question_text, corrected_answer_text: existing.corrected_answer_text, note: existing.note },
    fields as unknown as Record<string, unknown>);
  return (await getCorrection(id))!;
}

/** Approver/Admin decision on a proposed edit. Previous answer remains live until acceptance. */
export async function reviewCorrectionEdit(
  id: string,
  decision: "accept" | "reject",
  reviewerId: string,
  reason?: string
): Promise<CorrectionRow> {
  const existing = await getCorrection(id);
  if (!existing) throw new ApprovalError("Correction not found", 404);
  if (!existing.pending_edit) {
    throw new ApprovalError("This correction has no pending edit proposal.", 409);
  }

  const proposed = JSON.parse(existing.pending_edit) as PendingEditPayload;
  await setPendingEdit(id, null, null);

  if (decision === "accept") {
    await updateFromProposal(existing, proposed);
    const updated = (await getCorrection(id))!;
    await audit.write(existing.workspace_id, reviewerId, "correction.edit_approved", "correction", id,
      { question_text: existing.question_text, corrected_answer_text: existing.corrected_answer_text, note: existing.note },
      { question_text: updated.question_text, corrected_answer_text: updated.corrected_answer_text, note: updated.note, proposed_by: existing.pending_edit_by });
    return updated;
  }

  await audit.write(existing.workspace_id, reviewerId, "correction.edit_rejected", "correction", id,
    proposed as unknown as Record<string, unknown>,
    { reason: reason ?? null, proposed_by: existing.pending_edit_by });
  return (await getCorrection(id))!;
}

async function updateFromProposal(current: CorrectionRow, proposed: PendingEditPayload): Promise<void> {
  await updateCorrectionText(current.id, proposed);
  if (proposed.scope) {
    await updateCorrectionScope(current.id, proposed.scope, proposed.scope === "workspace" ? null : (proposed.document_id ?? current.document_id));
  }
  const updated = (await getCorrection(current.id))!;
  if (isLive(updated)) await syncIndexRow(updated);
}

export async function retireCorrection(id: string, actorId?: string): Promise<CorrectionRow> {
  const existing = await getCorrection(id);
  if (!existing) throw new Error("Correction not found");
  await setCorrectionStatus(id, "retired");
  await removeFromIndex(id);
  await audit.write(existing.workspace_id, actorId ?? existing.submitted_by, "correction.retired", "correction", id, { status: existing.status }, { status: "retired" });
  return (await getCorrection(id))!;
}

/** Walks the supersede chain backwards for audit history (FR-26). */
export async function correctionHistory(id: string): Promise<CorrectionRow[]> {
  const chain: CorrectionRow[] = [];
  const seen = new Set<string>();
  let current: string | null | undefined = id;
  while (current && !seen.has(current)) {
    seen.add(current);
    const row = await getCorrection(current);
    if (!row) break;
    chain.push(row);
    current = row.supersedes_correction_id;
  }
  return chain;
}

export async function activeCorrections(workspaceId: string, documentIds: string[]) {
  return listActiveCorrectionsForDocs(workspaceId, documentIds);
}

/**
 * FR-50/FR-51: turn an accepted SuggestedCorrection into a real correction.
 * Goes through the same approval gate as any other submission.
 */
export async function createCorrectionFromSuggestion(input: {
  workspace_id: string;
  document_id: string | null;
  original_query_log_id: string;
  question_text: string;
  wrong_answer_text: string;
  corrected_answer_text: string;
  note?: string | null;
  topic_tags?: string[];
  submitted_by: string;
  suggested_correction_id: string;
  submitter_role?: WorkspaceRole | null;
}): Promise<CorrectionRow> {
  // Role-gated: only Admin/Approver acceptances go live immediately.
  const status: CorrectionRow["status"] = canApprove(input.submitter_role) ? "active" : "pending";

  const correction = await insertCorrection({
    workspace_id: input.workspace_id,
    document_id: input.document_id,
    original_query_log_id: input.original_query_log_id,
    question_text: input.question_text,
    topic_tags: input.topic_tags ?? [],
    wrong_answer_text: input.wrong_answer_text,
    corrected_answer_text: input.corrected_answer_text,
    note: input.note ?? null,
    submitted_by: input.submitted_by,
    supersedes_correction_id: null,
    scope: input.document_id ? "document" : "workspace",
    status,
    suggested_correction_id: input.suggested_correction_id,
  });

  if (isLive(correction)) await syncIndexRow(correction);

  await audit.write(input.workspace_id, input.submitted_by, "suggestion.accepted", "correction", correction.id, null, {
    suggestion_id: input.suggested_correction_id,
    status,
    question: input.question_text,
  });
  await dispatchWebhook("correction.submitted", input.workspace_id, {
    correction_id: correction.id,
    status,
    from_suggestion: input.suggested_correction_id,
    requires_approval: status === "pending",
  });

  return correction;
}
