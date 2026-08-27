"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowBendDoubleUpLeft,
  ArrowRight,
  ChatsCircle,
  FileText,
  Gear,
  PaperPlaneRight,
  Plus,
  SealCheck,
  Trash,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { api, type ChatSessionDto, type CitationDto, type QueryResultDto } from "@/lib/client/api";
import { useActiveDocuments } from "@/lib/client/use-active-documents";
import type { DocumentDto } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/primitives";
import { AnswerCard } from "@/components/chat/answer-card";
import { FeedbackModal } from "@/components/chat/feedback-modal";
import { CorrectionForm } from "@/components/chat/correction-form";
import type { CorrectionDraft } from "@/components/chat/correction-form";
import type { ViewerTarget } from "@/components/chat/pdf-viewer";
import { cn } from "@/lib/utils";

const PdfViewer = dynamic(() => import("@/components/chat/pdf-viewer"), { ssr: false });

const MAX_RETRIES = 2;

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

  // Persistent chat sessions (Phase 1): resumable history stored server-side.
  const [sessions, setSessions] = useState<ChatSessionDto[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [chatsOpen, setChatsOpen] = useState(false);

  const [feedbackTarget, setFeedbackTarget] = useState<{ turnId: string; result: QueryResultDto } | null>(null);
  const [correctionDraft, setCorrectionDraft] = useState<(CorrectionDraft & { exhausted?: boolean }) | null>(null);

  const [viewer, setViewer] = useState<ViewerTarget | null>(null);
  const [originals, setOriginals] = useState<Record<string, QueryResultDto | null>>({});
  const [loadingOriginal, setLoadingOriginal] = useState<string | null>(null);
  const [confirmedUp, setConfirmedUp] = useState<Record<string, boolean>>({});

  const scrollRef = useRef<HTMLDivElement>(null);
  const chatsRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    void api.listDocuments().then(setDocs).catch(() => setDocs([]));
  }, []);

  // Load persistent chat sessions once. Resume the most recent one, or one
  // addressed explicitly via ?session=<id> (e.g. from the session list).
  useEffect(() => {
    (async () => {
      try {
        const { sessions: list } = await api.listChatSessions();
        setSessions(list);
        const paramId = new URLSearchParams(window.location.search).get("session");
        const target = paramId ? list.find((s) => s.id === paramId) : list[0];
        if (target) {
          const loaded = await loadSession(target.id);
          if (loaded && paramId) {
            window.history.replaceState({}, "", window.location.pathname);
          }
        }
      } catch {
        /* unauthenticated or offline — keep blank state */
      } finally {
        setSessionsLoaded(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Close the sessions dropdown on outside click / Escape.
  useEffect(() => {
    if (!chatsOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (chatsRef.current && !chatsRef.current.contains(e.target as Node)) setChatsOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setChatsOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [chatsOpen]);

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

  // --- Persistent chat sessions (Phase 1) ---

  function messagesToTurns(messages: Array<{ role: "user" | "assistant"; content: unknown; id: string }>): Turn[] {
    const out: Turn[] = [];
    let cur: Turn | null = null;
    for (const m of messages) {
      const c = m.content as { question?: string; result?: QueryResultDto };
      if (m.role === "user") {
        cur = { id: m.id, question: typeof c?.question === "string" ? c.question : "", variants: [] };
        out.push(cur);
      } else if (c?.result) {
        if (!cur) {
          cur = { id: m.id, question: "", variants: [] };
          out.push(cur);
        }
        cur.variants.push(c.result);
      }
    }
    return out;
  }

  const reloadSessions = useCallback(async () => {
    try {
      const { sessions: list } = await api.listChatSessions();
      setSessions(list);
      return list;
    } catch {
      return sessions;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSession = useCallback(
    async (id: string) => {
      try {
        const { session } = await api.getChatSession(id);
        setTurns(messagesToTurns(session.messages));
        // Reflect the active document scope captured in the session.
        const sessionDocIds = session.document_ids;
        if (sessionDocIds.length) {
          setAllDocsMode(false);
          setActiveIds(sessionDocIds);
        }
        setActiveSessionId(session.id);
        setError(null);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load chat");
        return false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const newChat = useCallback(() => {
    setTurns([]);
    setActiveSessionId(null);
    setError(null);
    if (window.location.search) window.history.replaceState({}, "", window.location.pathname);
  }, []);

  // Ensure an active session exists before persisting (auto-create on first ask).
  const resolveSessionId = useCallback(async (): Promise<string | null> => {
    if (activeSessionId) return activeSessionId;
    try {
      const { session } = await api.createChatSession({
        title: "New chat",
        document_ids: allDocsMode ? readyDocs.map((d) => d.id) : activeReadyIds,
      });
      setSessions((list) => [session, ...list]);
      setActiveSessionId(session.id);
      return session.id;
    } catch {
      return null;
    }
  }, [activeSessionId, allDocsMode, readyDocs, activeReadyIds]);

  const persistTurn = useCallback(
    async (sessionId: string, messages: Array<{ role: "user" | "assistant"; content: unknown; query_log_id?: string | null }>) => {
      try {
        await api.appendChatMessages(sessionId, messages);
        const list = await reloadSessions();
        void list;
      } catch {
        // Persistence is best-effort during a session; don't block the composer.
      }
    },
    [reloadSessions]
  );

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
      // Cached answers reuse the server's query_log_id, so the turn key must be
      // locally unique rather than derived from it.
      const turnId = crypto.randomUUID();
      setTurns((ts) => [...ts, { id: turnId, question, variants: [result] }]);
      // Persist the turn into a durable session (auto-created on first ask).
      const sessionId = await resolveSessionId();
      if (sessionId) {
        void persistTurn(sessionId, [
          { role: "user", content: { question } },
          { role: "assistant", content: { result }, query_log_id: result.query_log_id },
        ]);
      }
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
      // Persist the retry as another assistant message within the active session.
      if (activeSessionId) {
        void persistTurn(activeSessionId, [
          { role: "assistant", content: { result }, query_log_id: result.query_log_id },
        ]);
      }
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
        <div className="relative ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setChatsOpen((v) => !v);
              void reloadSessions();
            }}
            aria-expanded={chatsOpen}
            className="hidden shrink-0 sm:inline-flex"
          >
            <ChatsCircle size={13} weight={activeSessionId ? "fill" : "regular"} /> Chats
            {sessions.length > 0 && (
              <span className="ml-0.5 rounded-md border border-line px-1 font-mono text-[9px] text-ink-faint">{sessions.length}</span>
            )}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => (window.location.href = "/documents")} className="hidden shrink-0 sm:inline-flex">
            <Gear size={13} weight="light" /> Manage
          </Button>

          {chatsOpen && (
            <div ref={chatsRef} className="absolute right-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow-card)]">
              <div className="flex items-center justify-between border-b border-line px-3 py-2">
                <span className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">Recent chats</span>
                <button
                  onClick={() => {
                    newChat();
                    setChatsOpen(false);
                  }}
                  className="focus-ring inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-accent hover:bg-accent-soft"
                >
                  <Plus size={12} weight="bold" /> New chat
                </button>
              </div>
              <div className="max-h-[42vh] overflow-y-auto">
                {!sessionsLoaded ? (
                  <p className="px-3 py-4 text-xs text-ink-faint">Loading…</p>
                ) : sessions.length === 0 ? (
                  <p className="px-3 py-4 text-xs text-ink-faint">No saved chats yet — your questions are saved automatically.</p>
                ) : (
                  sessions.map((s) => (
                    <div
                      key={s.id}
                      className={cn(
                        "flex items-center gap-1 border-b border-line last:border-b-0",
                        s.id === activeSessionId && "bg-accent-soft"
                      )}
                    >
                      <button
                        onClick={() => {
                          setChatsOpen(false);
                          void loadSession(s.id);
                        }}
                        className="focus-ring min-w-0 flex-1 px-3 py-2 text-left hover:bg-surface-hover"
                      >
                        <span className="block truncate text-[13px] text-ink">{s.title || "New chat"}</span>
                        <span className="block font-mono text-[9px] uppercase tracking-wider text-ink-faint">
                          {s.message_count} message{s.message_count === 1 ? "" : "s"}
                        </span>
                      </button>
                      <button
                        onClick={async () => {
                          const ok = await api.deleteChatSession(s.id).catch(() => undefined);
                          if (ok) {
                            setSessions((list) => list.filter((x) => x.id !== s.id));
                            if (activeSessionId === s.id) newChat();
                          }
                        }}
                        className="focus-ring mr-1 rounded-md p-1.5 text-ink-faint transition-colors hover:bg-danger-soft hover:text-danger"
                        aria-label={`Delete chat ${s.title}`}
                      >
                        <Trash size={13} weight="light" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
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
                    Crispr retries with a different strategy, or saves your fix permanently.
                  </p>

                  {readyDocs.length === 0 && docs !== null && (
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
