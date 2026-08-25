"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowBendDoubleUpLeft,
  ArrowRight,
  FileText,
  Gear,
  PaperPlaneRight,
  SealCheck,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { api, type CitationDto, type QueryResultDto } from "@/lib/client/api";
import { useActiveDocuments } from "@/lib/client/use-active-documents";
import type { DocumentDto } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Chip, EmptyState } from "@/components/ui/primitives";
import { AnswerCard } from "@/components/chat/answer-card";
import { FeedbackModal } from "@/components/chat/feedback-modal";
import { CorrectionForm } from "@/components/chat/correction-form";
import type { CorrectionDraft } from "@/components/chat/correction-form";
import type { ViewerTarget } from "@/components/chat/pdf-viewer";
import { cn } from "@/lib/utils";

const PdfViewer = dynamic(() => import("@/components/chat/pdf-viewer"), { ssr: false });

const MAX_RETRIES = 2;
const EXAMPLES = [
  "What are the key obligations defined in this document?",
  "Summarize the limitations or exclusions mentioned.",
  "What dates and deadlines does this document specify?",
];

interface Turn {
  id: string;
  question: string;
  variants: QueryResultDto[];
}

type Phase = "corrections" | "retrieval" | "generation";
const PHASE_LABELS: Record<Phase, string> = {
  corrections: "Checking your corrections layer…",
  retrieval: "Retrieving relevant passages…",
  generation: "Generating cited answer…",
};

export default function ChatPage() {
  const [docs, setDocs] = useState<DocumentDto[] | null>(null);
  const { activeIds, setActiveIds, hydrated } = useActiveDocuments();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>("corrections");
  const [error, setError] = useState<string | null>(null);
  const [allDocsMode, setAllDocsMode] = useState(false);

  const [feedbackTarget, setFeedbackTarget] = useState<{ turnId: string; result: QueryResultDto } | null>(null);
  const [correctionDraft, setCorrectionDraft] = useState<(CorrectionDraft & { exhausted?: boolean }) | null>(null);

  const [viewer, setViewer] = useState<ViewerTarget | null>(null);
  const [originals, setOriginals] = useState<Record<string, QueryResultDto | null>>({});
  const [loadingOriginal, setLoadingOriginal] = useState<string | null>(null);
  const [confirmedUp, setConfirmedUp] = useState<Record<string, boolean>>({});

  const scrollRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    void api.listDocuments().then(setDocs).catch(() => setDocs([]));
  }, []);

  const readyDocs = useMemo(() => docs?.filter((d) => d.status === "ready") ?? [], [docs]);

  // Auto-select when exactly one ready doc exists and nothing selected yet
  useEffect(() => {
    if (!hydrated || !docs) return;
    if (activeIds.length === 0 && readyDocs.length > 0) setActiveIds([readyDocs[0].id]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, docs]);

  // Browser-extension handoff: /?doc=<id> preselects the freshly ingested document.
  useEffect(() => {
    const docParam = new URLSearchParams(window.location.search).get("doc");
    if (!docParam || !docs) return;
    if (docs.some((d) => d.id === docParam)) {
      setAllDocsMode(false);
      setActiveIds([docParam]);
    }
    window.history.replaceState({}, "", window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [turns, busy, reduce]);

  // Phase ticker during generation
  useEffect(() => {
    if (!busy) return;
    const order: Phase[] = ["corrections", "retrieval", "generation"];
    let i = 0;
    const t = setInterval(() => {
      i = Math.min(i + 1, order.length - 1);
      setPhase(order[i]);
    }, 1600);
    return () => clearInterval(t);
  }, [busy]);

  const activeReadyIds = useMemo(() => activeIds.filter((id) => readyDocs.some((d) => d.id === id)), [activeIds, readyDocs]);
  const namesById = useMemo(() => Object.fromEntries((docs ?? []).map((d) => [d.id, d.filename])), [docs]);
  /** FR-37: workspace-wide multi-document querying across every ready document. */
  const queryDocCount = allDocsMode ? readyDocs.length : activeReadyIds.length;

  const updateTurn = useCallback((turnId: string, fn: (t: Turn) => Turn) => {
    setTurns((ts) => ts.map((t) => (t.id === turnId ? fn(t) : t)));
  }, []);

  async function ask(question: string) {
    if (queryDocCount === 0 || busy) return;
    setInput("");
    setError(null);
    setBusy(true);
    setPhase("corrections");
    try {
      const result = allDocsMode
        ? await api.askWorkspaceWide(question)
        : await api.ask(question, activeReadyIds);
      setTurns((ts) => [...ts, { id: result.query_log_id, question, variants: [result] }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function retry(turnId: string, sourceVariant: QueryResultDto) {
    setError(null);
    setBusy(true);
    setPhase("retrieval");
    try {
      const result = await api.retry(sourceVariant.query_log_id);
      updateTurn(turnId, (t) => ({ ...t, variants: [...t.variants, result] }));
    } catch (err) {
      const e = err as Error & { status?: number };
      if (e.status === 409) {
        setCorrectionDraft({
          query_log_id: sourceVariant.query_log_id,
          question_text: turns.find((t) => t.id === turnId)?.question ?? sourceVariant.question,
          document_count: sourceVariant.citations.length ? new Set(sourceVariant.citations.map((c) => c.document_id)).size : activeReadyIds.length,
          exhausted: true,
        });
      } else {
        setError(e.message);
      }
    } finally {
      setBusy(false);
    }
  }

  function openFeedback(turnId: string, result: QueryResultDto) {
    setFeedbackTarget({ turnId, result });
  }

  function handleTryAgain(_note: string) {
    if (!feedbackTarget) return;
    const { turnId, result } = feedbackTarget;
    setFeedbackTarget(null);
    void retry(turnId, result);
  }

  function handleProvideCorrection(note: string) {
    if (!feedbackTarget) return;
    const { result } = feedbackTarget;
    setFeedbackTarget(null);
    setCorrectionDraft({
      query_log_id: result.query_log_id,
      question_text: result.question,
      document_count: activeReadyIds.length,
    });
    void note;
  }

  async function thumbsUp(result: QueryResultDto) {
    setConfirmedUp((m) => ({ ...m, [result.query_log_id]: true }));
    await api.feedback(result.query_log_id, "confirmed_correct").catch(() => undefined);
  }

  async function confirmCorrection(result: QueryResultDto) {
    await api.feedback(result.query_log_id, "confirmed_correct", result.correction?.id).catch(() => undefined);
    setConfirmedUp((m) => ({ ...m, [result.query_log_id]: true }));
  }

  async function rejectCorrection(result: QueryResultDto) {
    await api.feedback(result.query_log_id, "flagged").catch(() => undefined);
    openFeedback(
      turns.find((t) => t.variants.includes(result))?.id ?? "",
      result
    );
  }

  async function viewOriginal(turn: Turn, result: QueryResultDto) {
    const key = result.query_log_id;
    if (originals[key]) {
      setOriginals((o) => ({ ...o, [key]: null }));
      return;
    }
    setLoadingOriginal(key);
    try {
      const ids = allDocsMode ? readyDocs.map((d) => d.id) : activeReadyIds;
      const original = await api.originalAnswer(turn.question, ids);
      setOriginals((o) => ({ ...o, [key]: original }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate original answer");
    } finally {
      setLoadingOriginal(null);
    }
  }

  function cite(c: CitationDto) {
    setViewer({
      documentId: c.document_id,
      documentName: c.document_name ?? namesById[c.document_id] ?? c.document_id,
      page: c.page,
    });
  }

  const hasThread = turns.length > 0;

  return (
    <div className="flex h-[calc(100dvh-53px)] flex-col lg:h-[100dvh]">
      {/* Document scope bar */}
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5 md:px-6">
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-ink-faint">Querying</span>
        {docs === null ? (
          <div className="skeleton h-7 w-64" />
        ) : readyDocs.length === 0 ? (
          <Link href="/documents" className="focus-ring inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-accent hover:underline underline-offset-2">
            No ready documents — upload one first
            <ArrowRight size={11} weight="bold" />
          </Link>
        ) : (
          <>
            <button
              onClick={() => setAllDocsMode((v) => !v)}
              aria-pressed={allDocsMode}
              title={allDocsMode ? "Querying every ready document in the workspace (FR-37)" : "Query across ALL documents in the workspace"}
              className={cn(
                "focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-medium transition-colors duration-150",
                allDocsMode
                  ? "border-accent bg-accent text-on-accent"
                  : "border-line-strong bg-surface text-ink-soft hover:border-line-strong hover:text-ink"
              )}
            >
              All documents ({readyDocs.length})
            </button>
            {!allDocsMode && (
              <div className="flex flex-1 items-center gap-1.5 overflow-x-auto pb-0.5">
                {readyDocs.map((d) => {
                  const on = activeReadyIds.includes(d.id);
                  return (
                    <button
                      key={d.id}
                      onClick={() => setActiveIds(on ? activeReadyIds.filter((x) => x !== d.id) : [...activeReadyIds, d.id])}
                      aria-pressed={on}
                      title={d.filename}
                      className={cn(
                        "focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition-colors duration-150",
                        on
                          ? "border-accent-line bg-accent-soft font-medium text-accent-strong"
                          : "border-line bg-surface text-ink-soft hover:border-line-strong"
                      )}
                    >
                      <FileText size={11} weight={on ? "fill" : "regular"} />
                      <span className="max-w-[180px] truncate">{d.filename.replace(/\.[a-z0-9]+$/i, "")}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
        <Button variant="ghost" size="sm" onClick={() => (window.location.href = "/documents")} className="hidden sm:inline-flex">
          <Gear size={13} weight="light" /> Manage
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Thread */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div ref={scrollRef} className="flex-1 overflow-y-auto">
            {!hasThread ? (
              busy ? null : (
                <div className="mx-auto max-w-2xl px-4 pt-[14vh]">
                  <div className="mb-6 grid h-12 w-12 place-items-center rounded-2xl bg-accent text-on-accent shadow-[var(--shadow-card)]">
                    <SealCheck size={22} weight="fill" />
                  </div>
                  <h1 className="text-[26px] font-semibold leading-tight tracking-tight md:text-3xl">
                    Answers grounded in your PDFs,
                    <br />
                    <span className="text-accent">corrected by you</span> when they&apos;re wrong.
                  </h1>
                  <p className="mt-3 max-w-[52ch] text-sm leading-relaxed text-ink-soft">
                    Ask a question about your selected documents. Every answer cites its pages — flag anything wrong and
                    Crisp retries with a different strategy, or saves your fix permanently.
                  </p>

                  {readyDocs.length === 0 && docs !== null ? (
                    <EmptyState
                      icon={<FileText size={20} weight="light" />}
                      title={docs.length === 0 ? "No documents yet" : "Still processing"}
                      body={
                        docs.length === 0
                          ? "Upload a PDF to start asking questions about it."
                          : "Your documents are being indexed. This can take a moment."
                      }
                      action={
                        <Button variant="primary" size="sm" onClick={() => (window.location.href = "/documents")}>
                          Go to Documents
                        </Button>
                      }
                    />
                  ) : (
                    <div className="mt-8 grid gap-2">
                      <p className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">Try asking</p>
                      {EXAMPLES.map((ex) => (
                        <button
                          key={ex}
                          onClick={() => void ask(ex)}
                          disabled={!queryDocCount}
                          className="focus-ring group flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-left text-[13px] text-ink-soft transition-all duration-200 hover:border-accent-line hover:text-ink disabled:opacity-40"
                        >
                          {ex}
                          <ArrowRight size={13} weight="bold" className="shrink-0 opacity-0 transition-opacity duration-200 group-hover:opacity-60" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            ) : (
              <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 md:px-6">
                {turns.map((turn) => (
                  <div key={turn.id} className="space-y-3">
                    {/* Question */}
                    <div className="flex justify-end">
                      <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-surface-2 px-3.5 py-2.5 text-[13.5px] leading-relaxed">
                        {turn.question}
                      </p>
                    </div>
                    {/* Answer(s) — latest expanded, earlier collapsed */}
                    <div className="space-y-2.5">
                      {turn.variants.map((v, i) => (
                        <AnswerCard
                          key={v.query_log_id}
                          result={v}
                          documentNamesById={namesById}
                          isLatestVariant={i === turn.variants.length - 1}
                          onCite={cite}
                          onThumbsUp={() => void thumbsUp(v)}
                          onFlag={() => openFeedback(turn.id, v)}
                          onConfirmCorrection={() => void confirmCorrection(v)}
                          onRejectCorrection={() => void rejectCorrection(v)}
                          onViewOriginal={() => void viewOriginal(turn, v)}
                          originalResult={originals[v.query_log_id]}
                          loadingOriginal={loadingOriginal === v.query_log_id}
                        />
                      ))}
                    </div>
                    {confirmedUp[turn.variants[turn.variants.length - 1]?.query_log_id] && (
                      <p className="pl-1 font-mono text-[10px] text-accent">marked correct</p>
                    )}
                  </div>
                ))}

                {busy && (
                  <motion.div initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2.5">
                    <div className="flex items-center gap-2 pl-1">
                      <ArrowBendDoubleUpLeft size={13} weight="light" className="text-accent" />
                      <AnimatePresence mode="wait">
                        <motion.span
                          key={phase}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.25 }}
                          className="font-mono text-[10.5px] uppercase tracking-wider text-ink-faint"
                        >
                          {PHASE_LABELS[phase]}
                        </motion.span>
                      </AnimatePresence>
                    </div>
                    <div className="space-y-2 rounded-2xl border border-line bg-surface p-4">
                      <div className="skeleton h-3 w-11/12" />
                      <div className="skeleton h-3 w-9/12" />
                      <div className="skeleton h-3 w-10/12" />
                    </div>
                  </motion.div>
                )}

                {error && (
                  <div className="rounded-2xl border border-danger/25 bg-danger-soft p-3.5 text-[13px] leading-relaxed text-danger">
                    {error}
                  </div>
                )}

                {correctionDraft && (
                  <CorrectionForm
                    draft={correctionDraft}
                    onSuccess={() => setCorrectionDraft(null)}
                    onCancel={() => setCorrectionDraft(null)}
                  />
                )}
              </div>
            )}
          </div>

          {/* Composer */}
          <div className="border-t border-line bg-bg/80 p-3 backdrop-blur-lg md:p-4">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void ask(input.trim());
              }}
              className="mx-auto flex max-w-3xl items-end gap-2"
            >
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void ask(input.trim());
                  }
                }}
                rows={Math.min(5, Math.max(1, input.split("\n").length))}
                placeholder={
                  queryDocCount
                    ? allDocsMode
                      ? `Ask across all ${readyDocs.length} documents…`
                      : queryDocCount === 1
                        ? `Ask about ${namesById[activeReadyIds[0]]?.replace(/\.[a-z0-9]+$/i, "") ?? "this document"}…`
                        : `Ask across ${queryDocCount} documents…`
                    : "Select a ready document above to start…"
                }
                disabled={!queryDocCount}
                className="focus-ring max-h-[140px] min-h-[44px] flex-1 resize-none rounded-2xl border border-line-strong bg-surface px-4 py-2.5 text-[13.5px] leading-relaxed placeholder:text-ink-faint disabled:opacity-50"
              />
              <Button
                type="submit"
                variant="primary"
                aria-label="Send question"
                disabled={!input.trim() || !queryDocCount || busy}
                className="h-[44px] w-[44px] rounded-2xl p-0"
              >
                <PaperPlaneRight size={16} weight="fill" />
              </Button>
            </form>
            <p className="mx-auto mt-2 max-w-3xl text-center font-mono text-[10px] text-ink-faint">
              answers cite their sources · corrections override retrieval on future matches
            </p>
          </div>
        </div>

        {/* PDF viewer pane — desktop side panel */}
        {viewer && (
          <div className="hidden h-full w-[42%] min-w-[400px] max-w-[760px] shrink-0 border-l border-line lg:block">
            <PdfViewer target={viewer} onClose={() => setViewer(null)} />
          </div>
        )}
      </div>

      {/* PDF viewer — mobile overlay */}
      {viewer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <PdfViewer target={viewer} onClose={() => setViewer(null)} />
        </div>
      )}

      {/* Feedback modal */}
      {feedbackTarget && (
        <FeedbackModal
          question={feedbackTarget.result.question}
          retriesLeft={Math.max(0, MAX_RETRIES - feedbackTarget.result.attempt)}
          onTryAgain={handleTryAgain}
          onProvideCorrection={handleProvideCorrection}
          onClose={() => setFeedbackTarget(null)}
        />
      )}
    </div>
  );
}
