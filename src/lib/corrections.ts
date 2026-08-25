import { embedOne } from "./embeddings";
import { config } from "./config";
import {
  getCorrection,
  getQueryLog,
  insertCorrection,
  listActiveCorrectionsForDocs,
  setCorrectionStatus,
  updateCorrectionText,
  updateCorrectionScope,
} from "./db";
import { removeCorrectionVector, searchCorrections, upsertCorrectionVectors } from "./vector";
import type { CorrectionRow } from "./types";

export interface SubmitCorrectionInput {
  query_log_id: string;
  corrected_answer: string;
  note?: string | null;
  scope?: "document" | "workspace";
  topic_tags?: string[];
  /** Conflict resolution action when a similar ACTIVE correction already exists. */
  resolve?: "replace" | "annotate" | "keep";
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

export async function detectConflict(workspaceId: string, documentIds: string[], questionText: string): Promise<CorrectionRow | null> {
  const vector = await embedOne(questionText);
  const hits = await searchCorrections(vector, workspaceId, documentIds, config.correctionConflictThreshold);
  for (const hit of hits) {
    const existing = getCorrection(hit.id);
    if (existing?.status === "active") return existing;
  }
  return null;
}

export async function submitCorrection(input: SubmitCorrectionInput): Promise<SubmitCorrectionResult> {
  const log = getQueryLog(input.query_log_id);
  if (!log) throw new Error("Original query log not found");

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
      setCorrectionStatus(existing.id, "superseded");
      await removeCorrectionVector(existing.id).catch(() => undefined);
      supersedesId = existing.id;
    }
  }

  const correction = insertCorrection({
    workspace_id: log.workspace_id,
    document_id: documentId,
    original_query_log_id: log.id,
    question_text: log.question_text,
    topic_tags: input.topic_tags ?? [],
    wrong_answer_text: log.answer_text,
    corrected_answer_text: input.corrected_answer,
    note: input.note ?? null,
    submitted_by: log.user_id,
    supersedes_correction_id: supersedesId,
    scope,
  });

  await syncIndexRow(correction);

  if (input.resolve === "replace" && !supersedesId && conflictWith) {
    void conflictWith;
  }

  return { correction, conflictWith: null };
}

export async function editCorrection(
  id: string,
  fields: { question_text?: string; corrected_answer_text?: string; note?: string | null; topic_tags?: string[]; scope?: "document" | "workspace"; document_id?: string | null }
): Promise<CorrectionRow> {
  const existing = getCorrection(id);
  if (!existing) throw new Error("Correction not found");

  updateCorrectionText(id, fields);
  if (fields.scope) updateCorrectionScope(id, fields.scope, fields.scope === "workspace" ? null : (fields.document_id ?? existing.document_id));

  const updated = getCorrection(id)!;
  await syncIndexRow(updated);
  return updated;
}

export async function retireCorrection(id: string): Promise<CorrectionRow> {
  const existing = getCorrection(id);
  if (!existing) throw new Error("Correction not found");
  setCorrectionStatus(id, "retired");
  await removeCorrectionVector(id).catch(() => undefined);
  return getCorrection(id)!;
}

/** Walks the supersede chain backwards for audit history (FR-26). */
export function correctionHistory(id: string): CorrectionRow[] {
  const chain: CorrectionRow[] = [];
  const seen = new Set<string>();
  let current: string | null | undefined = id;
  while (current && !seen.has(current)) {
    seen.add(current);
    const row = getCorrection(current);
    if (!row) break;
    chain.push(row);
    current = row.supersedes_correction_id;
  }
  return chain;
}

export function activeCorrections(workspaceId: string, documentIds: string[]) {
  return listActiveCorrectionsForDocs(workspaceId, documentIds);
}
