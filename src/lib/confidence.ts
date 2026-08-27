import type { ConfidenceScore } from "./types";

/**
 * Answer confidence derived from retrieval relevance and source agreement,
 * blended with the citation-groundedness heuristic already used by the app.
 * The score is informational only — it never gates or flags answers.
 *
 * Calibration notes:
 * - MiniLM-L6-v2 cosines for genuinely relevant passages typically land 0.40-0.70;
 *   we map [0.25, 0.75] -> [0, 1] so "relevant" doesn't read as mediocre.
 * - Agreement = how much of the retrieved context the generator actually relied on;
 *   citing 1 of 6 chunks hints the rest disagreed with the answer.
 * - Human corrections are treated as near-certain (a person asserted the fact).
 */

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function calibrateRelevance(similarity: number): number {
  return clamp01((similarity - 0.25) / 0.5);
}

export function confidenceFromDocumentAnswer(input: {
  chunkScores: number[]; // similarity of every retrieved candidate
  citedCount: number; // chunks actually cited in the answer
  groundedness: number; // 0..100 heuristic
}): number {
  const { chunkScores, citedCount } = input;
  if (!chunkScores.length) return 0.15;

  const top = [...chunkScores].sort((a, b) => b - a);
  const k = Math.min(3, top.length);
  const meanTop3 = top.slice(0, k).reduce((s, v) => s + calibrateRelevance(v), 0) / k;
  const best = calibrateRelevance(top[0]);
  const agreement = clamp01(citedCount / Math.min(chunkScores.length, 6));
  const groundedness01 = clamp01(input.groundedness / 100);

  // Weights sum to 1: relevance dominates, grounding and agreement are strong signals.
  const score = 0.4 * meanTop3 + 0.2 * best + 0.1 * agreement + 0.3 * groundedness01;
  return Math.round(clamp01(score) * 100) / 100;
}

export function confidenceForCorrection(): number {
  return 0.99;
}

export function confidenceForNoAnswer(): number {
  return 0.2;
}

export function buildConfidence(score: number): ConfidenceScore {
  const rounded = Math.round(clamp01(score) * 100) / 100;
  return {
    score: rounded,
    threshold: 0,
    flagged_needs_review: false,
  };
}
