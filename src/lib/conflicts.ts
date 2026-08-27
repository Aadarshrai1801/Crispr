import { config } from "./config";
import { generateConflictVerdicts, LlmNotConfiguredError } from "./llm";
import { logger } from "./logger";
import {
  findExistingConflict,
  getDocument,
  insertConflictAlert,
  listDocuments,
} from "./db";
import { listWorkspaceChunks } from "./vector";
import { audit } from "./audit";
import { dispatchWebhook } from "./webhooks";

/**
 * FR-43: periodically scans workspace documents for passages making conflicting
 * factual claims on the same topic and surfaces proactive Conflict alerts,
 * independent of any user querying that content.
 *
 * Pipeline: workspace-wide chunk dump -> cross-document cosine pairing above a
 * conservative similarity floor -> batched LLM verification of "do these two
 * passages actually contradict each other?" -> deduped ConflictAlert rows.
 */

interface CandidatePair {
  aIndex: number;
  bIndex: number;
  similarity: number;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) dot += a[i] * b[i];
  return dot;
}

function findCandidatePairs(
  vectors: number[][],
  docIds: string[],
  minSimilarity: number,
  maxPairs: number
): CandidatePair[] {
  const pairs: CandidatePair[] = [];
  const n = vectors.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (docIds[i] === docIds[j]) continue; // conflicts are CROSS-document
      const sim = cosine(vectors[i], vectors[j]);
      if (sim >= minSimilarity) pairs.push({ aIndex: i, bIndex: j, similarity: sim });
    }
  }
  return pairs.sort((a, b) => b.similarity - a.similarity).slice(0, maxPairs);
}

export interface ConflictScanResult {
  scanned_chunks: number;
  candidate_pairs: number;
  alerts_created: number;
  llm_verified: boolean;
}

export async function scanWorkspaceConflicts(workspaceId: string, actorId?: string): Promise<ConflictScanResult> {
  const docs = (await listDocuments(workspaceId)).filter((d) => d.status === "ready");
  if (docs.length < 2) {
    return { scanned_chunks: 0, candidate_pairs: 0, alerts_created: 0, llm_verified: false };
  }

  const chunks = await listWorkspaceChunks(workspaceId, config.conflictScanMaxChunks);
  const usable = chunks.filter((c) => c.vector?.length && c.text.trim().length > 80);
  if (usable.length < 2) {
    return { scanned_chunks: usable.length, candidate_pairs: 0, alerts_created: 0, llm_verified: false };
  }

  // Cap pairwise work: keep the highest-signal subset when a workspace is huge.
  const capped = usable.slice(0, config.conflictScanMaxChunks);
  const candidates = findCandidatePairs(
    capped.map((c) => c.vector),
    capped.map((c) => c.document_id),
    config.conflictCandidateSimilarity,
    16
  );
  if (!candidates.length) {
    return { scanned_chunks: capped.length, candidate_pairs: 0, alerts_created: 0, llm_verified: false };
  }

  const namesById = new Map(docs.map((d) => [d.id, d.filename]));
  const passageText = (i: number) =>
    `${namesById.get(capped[i].document_id) ?? capped[i].document_id} p.${capped[i].page_number}: ${capped[i].text.slice(0, 700)}`;

  let verdicts: Array<{ index: number; conflicting: boolean; rationale?: string }> | null = null;
  let llmVerified = true;
  try {
    verdicts = await generateConflictVerdicts(
      candidates.map((p, idx) => ({
        index: idx + 1,
        passageA: passageText(p.aIndex),
        passageB: passageText(p.bIndex),
      }))
    );
  } catch (err) {
    if (!(err instanceof LlmNotConfiguredError)) logger.warn({ err }, "conflict LLM verification failed");
    llmVerified = false;
  }

  let created = 0;
  for (let k = 0; k < candidates.length; k++) {
    const pair = candidates[k];
    const A = capped[pair.aIndex];
    const B = capped[pair.bIndex];
    if (await findExistingConflict(workspaceId, A.id, B.id)) continue;

    const verdict = verdicts?.find((v) => v.index === k + 1);
    if (llmVerified && verdict && !verdict.conflicting) continue;

    const rationale =
      verdict?.rationale ??
      (llmVerified ? null : "Heuristic match only (LLM verification unavailable) — review manually.");

    await insertConflictAlert({
      workspace_id: workspaceId,
      document_a_id: A.document_id,
      passage_a_ref: A.id,
      passage_a_text: A.text.slice(0, 1200),
      document_b_id: B.document_id,
      passage_b_ref: B.id,
      passage_b_text: B.text.slice(0, 1200),
      similarity: pair.similarity,
      rationale,
    });
    created++;
    const docAName = namesById.get(A.document_id) ?? A.document_id;
    const docBName = namesById.get(B.document_id) ?? B.document_id;
    await audit.write(workspaceId, actorId ?? "system", "conflict.detected", "document_pair", `${A.document_id}~${B.document_id}`, null, {
      document_a: docAName,
      document_b: docBName,
      similarity: Number(pair.similarity.toFixed(4)),
      verified_by_llm: llmVerified,
    });
    await dispatchWebhook("conflict.detected", workspaceId, {
      document_a: { id: A.document_id, name: docAName, page: A.page_number },
      document_b: { id: B.document_id, name: docBName, page: B.page_number },
      similarity: pair.similarity,
      rationale,
    });
  }

  void getDocument; // (documents resolved above)
  return { scanned_chunks: capped.length, candidate_pairs: candidates.length, alerts_created: created, llm_verified: llmVerified };
}
