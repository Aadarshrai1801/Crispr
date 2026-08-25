import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function normalizeQuestion(q: string): string {
  return q.toLowerCase().trim().replace(/\s+/g, " ");
}

export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}

/**
 * Normalizes citation markers models occasionally emit in non-ASCII bracket styles
 * (【1】, ［1,2］, [ 3 ]) into plain [1][2][3] so parsing/rendering stays reliable.
 */
export function normalizeCitationMarkers(text: string): string {
  return text.replace(
    /[【［[]\s*(\d{1,2}(?:\s*[,,]\s*\d{1,2})*)\s*[】］\]]/g,
    (_match, nums: string) =>
      nums
        .split(/[,，]/)
        .map((n) => `[${n.trim()}]`)
        .join("")
  );
}

/**
 * Heuristic groundedness score: share of answer sentences carrying an inline [n]
 * citation whose n exists among provided citation indices.
 */
export function computeGroundedness(answer: string, validIndices: number[]): number {
  const sentences = answer.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
  if (!sentences.length) return 0;
  let cited = 0;
  const re = /\[(\d+)\]/g;
  for (const s of sentences) {
    let hasValidCite = false;
    for (const m of s.matchAll(re)) {
      if (validIndices.includes(Number(m[1]))) hasValidCite = true;
    }
    if (!hasValidCite && /\[\d+\]/.test(s)) continue; // cites nonexistent passage -> not grounded
    if (hasValidCite) cited++;
  }
  return Math.round((cited / sentences.length) * 100);
}
