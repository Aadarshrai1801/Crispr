"use client";

import { useMemo } from "react";
import {
  ArrowsClockwise,
  CaretDown,
  Check,
  Flag,
  SealCheck,
  ThumbsUp,
  WarningCircle,
} from "@phosphor-icons/react";
import type { CitationDto, QueryResultDto } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/primitives";
import { cn, formatDate } from "@/lib/utils";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";

function GroundednessMeter({ score }: { score: number }) {
  const tone = score >= 80 ? "bg-accent" : score >= 50 ? "bg-warn" : "bg-danger";
  return (
    <span className="inline-flex items-center gap-1.5" title="Share of sentences with valid citations (heuristic)">
      <span className="h-1 w-10 overflow-hidden rounded-full bg-surface-2">
        <span className={cn("block h-full rounded-full transition-all duration-500", tone)} style={{ width: `${Math.max(score, 4)}%` }} />
      </span>
      <span className="font-mono text-[10px] text-ink-faint tabular-nums">{score}%</span>
    </span>
  );
}

export function AnswerCard({
  result,
  documentNamesById,
  isLatestVariant,
  onCite,
  onThumbsUp,
  onFlag,
  onConfirmCorrection,
  onRejectCorrection,
  onViewOriginal,
  originalResult,
  loadingOriginal,
}: {
  result: QueryResultDto;
  documentNamesById: Record<string, string>;
  isLatestVariant: boolean;
  onCite: (citation: CitationDto) => void;
  onThumbsUp: () => void;
  onFlag: () => void;
  onConfirmCorrection?: () => void;
  onRejectCorrection?: () => void;
  onViewOriginal: () => void;
  originalResult?: QueryResultDto | null;
  loadingOriginal?: boolean;
}) {
  const reduce = useReducedMotion();

  // Parse answer into text + citation-marker segments
  const segments = useMemo(() => {
    const parts = result.answer.split(/(\[\d+\])/g);
    return parts.map((part) => {
      const m = part.match(/^\[(\d+)\]$/);
      if (!m) return { kind: "text" as const, text: part };
      const idx = Number(m[1]) - 1;
      return { kind: "cite" as const, index: idx };
    });
  }, [result.answer]);

  const citationAt = (i: number): CitationDto | undefined => result.citations[i];

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "rounded-2xl border bg-surface p-4 shadow-[var(--shadow-card)]",
        result.source_type === "correction" && "border-accent-line"
      )}
    >
      {/* Header badges */}
      <div className="mb-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {result.attempt > 0 && (
          <Chip>
            <ArrowsClockwise size={10} weight="bold" /> Retry · attempt {result.attempt}
          </Chip>
        )}
        {result.source_type === "document" && (
          <>
            <Chip tone="accent">
              <SealCheck size={10} weight="fill" /> From documents
            </Chip>
            {result.groundedness >= 0 && <GroundednessMeter score={result.groundedness} />}
          </>
        )}
        {result.source_type === "correction" && result.correction && (
          <Chip tone="accent">
            <SealCheck size={10} weight="fill" /> Corrected by you · {formatDate(result.correction.created_at)}
          </Chip>
        )}
        {result.source_type === "no_answer" && (
          <Chip tone="warn">
            <WarningCircle size={10} weight="fill" /> Not answerable from these documents
          </Chip>
        )}
        {!isLatestVariant && <Chip>superseded attempt</Chip>}
      </div>

      {/* Answer body with citation chips */}
      <p className="text-[13.5px] leading-relaxed text-ink">
        {segments.map((seg, i) =>
          seg.kind === "text" ? (
            <span key={i}>{seg.text}</span>
          ) : (
            (() => {
              const c = citationAt(seg.index);
              if (!c)
                return (
                  <sup key={i} className="mx-0.5 font-mono text-[9px] text-ink-faint">
                    [{seg.index + 1}]
                  </sup>
                );
              return (
                <button
                  key={i}
                  onClick={() => onCite(c)}
                  title={`Open ${c.document_name ?? "document"} p.${c.page}${c.section_label ? ` — ${c.section_label}` : ""}`}
                  className="focus-ring mx-0.5 inline-flex translate-y-[-2px] items-center gap-0.5 rounded-md border border-accent-line bg-accent-soft px-1 py-px align-baseline font-mono text-[10px] font-medium text-accent-strong transition-colors duration-150 hover:bg-accent hover:text-on-accent"
                >
                  p.{c.page}
                </button>
              );
            })()
          )
        )}
      </p>

      {/* Correction extras */}
      {result.source_type === "correction" && result.correction && (
        <div className="mt-3 space-y-2.5 rounded-xl border border-line bg-bg/60 p-3">
          <p className="text-xs leading-relaxed text-ink-soft">
            <span className="font-medium text-ink">Why:</span>{" "}
            {result.correction.note || "This answer was manually corrected and now overrides the document-derived one."}
          </p>
          <details className="group/details">
            <summary className="flex w-full cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-ink-soft transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
              <CaretDown size={11} className="transition-transform duration-200 group-open/details:rotate-180" />
              Show the superseded wrong answer
            </summary>
            <p className="mt-2 border-l-2 border-danger/40 pl-3 text-xs leading-relaxed text-ink-faint line-through decoration-danger/40">
              {result.correction.wrong_answer_text}
            </p>
          </details>
          <button
            onClick={onViewOriginal}
            disabled={loadingOriginal}
            className="focus-ring rounded-md text-xs font-medium text-accent underline-offset-2 transition-colors hover:text-accent-strong hover:underline disabled:opacity-50"
          >
            {loadingOriginal
              ? "Generating original answer…"
              : originalResult
                ? "Hide original document answer"
                : "View original document answer"}
          </button>
          {loadingOriginal && (
            <div className="space-y-2 pt-1">
              <div className="skeleton h-3 w-3/4" />
              <div className="skeleton h-3 w-2/3" />
            </div>
          )}
          {originalResult && (
            <AnimatePresence initial={false}>
              {originalResult && (
                <motion.div
                  key="original"
                  initial={reduce ? false : { opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  className="overflow-hidden"
                >
                  <div className="rounded-lg border border-line bg-surface p-3">
                    <Chip className="mb-1.5">Original document-derived answer</Chip>
                    <p className="text-xs leading-relaxed text-ink-soft">{originalResult.answer}</p>
                    {originalResult.citations.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {originalResult.citations.map((c) => (
                          <button
                            key={c.chunk_id + c.page}
                            onClick={() => onCite(c)}
                            className="focus-ring rounded-md border border-line px-1.5 py-0.5 font-mono text-[10px] text-ink-soft hover:border-accent-line hover:text-accent"
                          >
                            {c.document_name?.replace(/\.pdf$/i, "")} · p.{c.page}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          )}
          {result.correction.needs_confirmation && isLatestVariant && (
            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
              <span className="text-xs text-ink-soft">Did this answer your question?</span>
              <Button size="sm" variant="primary" onClick={onConfirmCorrection}>
                <Check size={11} weight="bold" /> Yes
              </Button>
              <Button size="sm" variant="ghost" onClick={onRejectCorrection}>
                No
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Citations footer */}
      {result.citations.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {result.citations.map((c, i) => (
            <button
              key={`${c.chunk_id}-${i}`}
              onClick={() => onCite(c)}
              title={`Open ${c.document_name ?? "document"} page ${c.page}`}
              className="focus-ring inline-flex items-center gap-1 rounded-lg border border-line bg-surface-2 px-2 py-1 font-mono text-[10.5px] text-ink-soft transition-colors duration-150 hover:border-accent-line hover:bg-accent-soft hover:text-accent"
            >
              {(c.document_name ?? c.document_id).replace(/\.pdf$/i, "").slice(0, 22)} · p.{c.page}
            </button>
          ))}
        </div>
      )}

      {/* Actions */}
      {isLatestVariant && (
        <footer className="mt-3 flex items-center justify-between border-t border-line pt-2.5">
          <span className="truncate font-mono text-[10px] text-ink-faint">{result.strategy_note}</span>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              aria-label="Good answer"
              onClick={onThumbsUp}
              title="Mark as correct"
            >
              <ThumbsUp size={13} weight="light" />
            </Button>
            <Button variant="ghost" size="sm" onClick={onFlag} className="text-ink-soft">
              <Flag size={13} weight="light" />
              This is wrong
            </Button>
          </div>
        </footer>
      )}
    </motion.div>
  );
}
