"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowClockwise,
  CaretDown,
  ChatCircleDots,
  Check,
  CheckCircle,
  Warning,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { api, type ConflictAlertDto, type CorrectionDto, type CommentDto, type SuggestedCorrectionDto } from "@/lib/client/api";
import { useSession } from "@/lib/client/use-session";
import { Button } from "@/components/ui/button";
import { Chip, EmptyState, Skeleton } from "@/components/ui/primitives";
import { cn, formatDate } from "@/lib/utils";

type Tab = "queue" | "suggestions" | "conflicts";

export default function ApprovalsPage() {
  const session = useSession();
  const [tab, setTab] = useState<Tab>("queue");
  const [pending, setPending] = useState<CorrectionDto[] | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestedCorrectionDto[] | null>(null);
  const [conflicts, setConflicts] = useState<ConflictAlertDto[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    const wsId = session.workspaceId;
    setError(null);
    const results = await Promise.allSettled([api.pendingCorrections(wsId), api.suggestions(wsId), api.conflicts(wsId)]);
    setPending(results[0].status === "fulfilled" ? results[0].value.corrections : []);
    setSuggestions(results[1].status === "fulfilled" ? results[1].value.suggestions.filter((s) => s.status === "pending") : []);
    setConflicts(results[2].status === "fulfilled" ? results[2].value.conflicts.filter((c) => c.status === "open") : []);
    if (results.some((r) => r.status === "rejected")) {
      const firstError = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      setError(firstError.reason instanceof Error ? firstError.reason.message : "Failed to load");
    }
  }, [session.workspaceId]);

  useEffect(() => {
    if (session.hydrated) void loadAll();
  }, [session.hydrated, loadAll]);

  async function approve(c: CorrectionDto, supersede = false) {
    try {
      await api.approveCorrection(c.id, supersede);
      setNotice(`Approved — now live for the whole workspace.`);
      await loadAll();
    } catch (err) {
      const e = err as Error & { status?: number; payload?: { code?: string } };
      if (e.payload?.code === "conflicting_active") {
        if (confirm("A near-identical correction is already live.\n\nFirst-approved-wins by default. Supersede it with this one?")) {
          await approve(c, true);
        }
      } else {
        setError(e.message);
      }
    }
  }

  async function reject(c: CorrectionDto) {
    const reason = prompt("Rejection reason (retained in the audit log):");
    if (!reason || reason.trim().length < 3) return;
    try {
      await api.rejectCorrection(c.id, reason.trim());
      setNotice("Rejected with reason recorded.");
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reject failed");
    }
  }

  const pendingCount = pending?.length ?? 0;
  const suggestionCount = suggestions?.length ?? 0;
  const conflictCount = conflicts?.length ?? 0;

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-8 md:px-8 md:py-10">
      <header className="mb-6">
        <p className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">Trust & compounding intelligence</p>
        <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
        <p className="mt-1 max-w-[68ch] text-[13px] leading-relaxed text-ink-soft">
          Review pending corrections before they enter the shared override layer, act on system-suggested fixes, and resolve
          conflicting claims detected across documents.
        </p>
      </header>

      <div className="mb-6 flex flex-wrap items-center gap-1 border-b border-line pb-3">
        {([
          ["queue", `Queue (${pendingCount})`],
          ["suggestions", `Suggestions (${suggestionCount})`],
          ["conflicts", `Conflicts (${conflictCount})`],
        ] as Array<[Tab, string]>).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            aria-pressed={tab === id}
            className={cn(
              "focus-ring rounded-lg px-3 py-1.5 text-xs font-medium transition-colors duration-150",
              tab === id ? "bg-accent-soft text-accent-strong" : "text-ink-soft hover:bg-surface-hover"
            )}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto flex gap-2">
          {tab === "suggestions" && (
            <Button size="sm" onClick={() => void api.runFlagAnalysis(session.workspaceId).then(loadAll).catch((e) => setError(e.message))}>
              <ArrowClockwise size={12} /> Re-analyze flags
            </Button>
          )}
          {tab === "conflicts" && (
            <Button size="sm" onClick={() => void api.runConflictScan(session.workspaceId).then(loadAll).catch((e) => setError(e.message))}>
              <ArrowClockwise size={12} /> Scan documents
            </Button>
          )}
        </span>
      </div>

      {(notice || error) && (
        <div className={cn("mb-4 rounded-xl border p-3 text-[13px]", error ? "border-danger/25 bg-danger-soft text-danger" : "border-accent-line bg-accent-soft text-accent-strong")}>
          {error ?? notice}
        </div>
      )}

      {!session.hydrated || pending === null || suggestions === null || conflicts === null ? (
        <Skeleton className="h-64" />
      ) : tab === "queue" ? (
        <QueueTab
          corrections={pending}
          onApprove={(c) => void approve(c)}
          onReject={(c) => void reject(c)}
        />
      ) : tab === "suggestions" ? (
        <SuggestionsTab suggestions={suggestions} onChanged={() => void loadAll()} />
      ) : (
        <ConflictsTab conflicts={conflicts} onChanged={() => void loadAll()} />
      )}
    </div>
  );
}

/* ------------------------------ Queue ------------------------------ */

function QueueTab({
  corrections,
  onApprove,
  onReject,
}: {
  corrections: CorrectionDto[];
  onApprove: (c: CorrectionDto) => void;
  onReject: (c: CorrectionDto) => void;
}) {
  const [sortKey, setSortKey] = useState<"age" | "document" | "submitter">("age");

  const sorted = useMemo(() => {
    const list = [...corrections];
    if (sortKey === "age") list.sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (sortKey === "submitter") list.sort((a, b) => a.submitted_by.localeCompare(b.submitted_by));
    if (sortKey === "document") list.sort((a, b) => (a.document_id ?? "").localeCompare(b.document_id ?? ""));
    return list;
  }, [corrections, sortKey]);

  if (corrections.length === 0) {
    return (
      <EmptyState
        icon={<CheckCircle size={20} weight="light" />}
        title="Nothing awaiting review"
        body='Submitted corrections land here when the workspace has "Approval required" enabled.'
      />
    );
  }

  return (
    <>
      <div className="mb-3 flex items-center gap-2 text-xs text-ink-soft">
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">sort by</span>
        {(["age", "document", "submitter"] as const).map((k) => (
          <button key={k} onClick={() => setSortKey(k)} aria-pressed={sortKey === k}
            className={cn("focus-ring rounded-md px-2 py-0.5 capitalize", sortKey === k ? "bg-accent-soft font-medium text-accent-strong" : "hover:bg-surface-hover")}>
            {k}
          </button>
        ))}
      </div>
      <div className="space-y-3">
        {sorted.map((c) => (
          <PendingCard key={c.id} correction={c} onApprove={() => onApprove(c)} onReject={() => onReject(c)} />
        ))}
      </div>
    </>
  );
}

function PendingCard({ correction: c, onApprove, onReject }: { correction: CorrectionDto; onApprove: () => void; onReject: () => void }) {
  const reduce = useReducedMotion();
  const [openComments, setOpenComments] = useState(false);
  const [comments, setComments] = useState<CommentDto[] | null>(null);
  const [commentText, setCommentText] = useState("");
  const [busy, setBusy] = useState(false);

  async function toggleComments() {
    const next = !openComments;
    setOpenComments(next);
    if (next && !comments) {
      try {
        const { comments: list } = await api.comments(c.id);
        setComments(list);
      } catch {
        setComments([]);
      }
    }
  }

  async function postComment() {
    if (!commentText.trim()) return;
    try {
      await api.addComment(c.id, commentText.trim());
      setCommentText("");
      setComments(await api.comments(c.id).then((r) => r.comments));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Comment failed");
    }
  }

  return (
    <motion.div layout={!reduce} className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Chip tone="warn">{c.status}</Chip>
        <Chip>{c.scope === "workspace" ? "workspace-wide" : c.document_id?.slice(0, 14) + "…"}</Chip>
        <span className="ml-auto font-mono text-[10px] text-ink-faint tabular-nums">
          submitted {formatDate(c.created_at)} · by {c.submitted_by.replace(/^user_/, "")}
        </span>
      </div>

      <p className="mt-2.5 text-[13px] font-medium leading-snug">{c.question_text}</p>

      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <div className="rounded-xl border border-danger/20 bg-danger-soft/50 p-2.5">
          <p className="font-mono text-[9px] uppercase tracking-wider text-danger">was</p>
          <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-ink-soft">{c.wrong_answer_text}</p>
        </div>
        <div className="rounded-xl border border-accent-line bg-accent-soft p-2.5">
          <p className="font-mono text-[9px] uppercase tracking-wider text-accent-strong">proposed fix</p>
          <p className="mt-1 text-xs leading-relaxed text-ink">{c.corrected_answer_text}</p>
        </div>
      </div>

      {c.note && <p className="mt-2 text-xs italic leading-relaxed text-ink-faint">Note: {c.note}</p>}

      <footer className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
        <Button size="sm" variant="primary" disabled={busy} onClick={() => { setBusy(true); onApprove(); }}>
          <Check size={12} weight="bold" /> Approve
        </Button>
        <Button size="sm" variant="danger" disabled={busy} onClick={() => { setBusy(true); onReject(); }}>
          <X size={12} weight="bold" /> Reject
        </Button>
        <span className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => void toggleComments()}>
            <ChatCircleDots size={13} weight="light" /> Discussion{comments ? ` (${comments.length})` : ""}
            <CaretDown size={9} className={cn("transition-transform duration-200", openComments && "rotate-180")} />
          </Button>
        </span>
      </footer>

      <AnimatePresence initial={false}>
        {openComments && (
          <motion.div initial={reduce ? false : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }} className="overflow-hidden">
            <div className="mt-3 space-y-2 rounded-xl bg-bg/60 p-3">
              {comments === null ? (
                <Skeleton className="h-16" />
              ) : comments.length === 0 ? (
                <p className="text-xs text-ink-faint">No discussion yet.</p>
              ) : (
                comments.map((cm) => (
                  <div key={cm.id} className="rounded-lg border border-line bg-surface px-2.5 py-2">
                    <p className="font-mono text-[9px] uppercase tracking-wider text-ink-faint">
                      {cm.author_id.replace(/^user_/, "")} · {formatDate(cm.created_at)}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed">{cm.body}</p>
                  </div>
                ))
              )}
              <div className="flex gap-2 pt-1">
                <input
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void postComment()}
                  placeholder="Add to the discussion…"
                  className="focus-ring h-8 flex-1 rounded-lg border border-line-strong bg-surface px-2.5 text-xs"
                />
                <Button size="sm" disabled={!commentText.trim()} onClick={() => void postComment()}>Post</Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ------------------------------ Suggestions ------------------------------ */

function SuggestionsTab({ suggestions, onChanged }: { suggestions: SuggestedCorrectionDto[]; onChanged: () => void }) {
  if (suggestions.length === 0) {
    return (
      <EmptyState
        icon={<CheckCircle size={20} weight="light" />}
        title="No suggestions right now"
        body="Cross-document matches appear after approvals (FR-50); repeatedly-flagged questions generate draft fixes here automatically (FR-51)."
      />
    );
  }

  return (
    <div className="space-y-3">
      {suggestions.map((s) => (
        <SuggestionCard key={s.id} suggestion={s} onChanged={onChanged} />
      ))}
    </div>
  );
}

function SuggestionCard({ suggestion: s, onChanged }: { suggestion: SuggestedCorrectionDto; onChanged: () => void }) {
  const pattern = useMemo<SuggestedPattern>(() => {
    try {
      return JSON.parse(s.source_pattern);
    } catch {
      return { type: "repeated_question", cluster: [] };
    }
  }, [s.source_pattern]);
  const [draft, setDraft] = useState(s.suggested_text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "accept" | "dismiss") {
    setBusy(true);
    setError(null);
    try {
      await api.actOnSuggestion(s.id, action, action === "accept" ? draft : undefined);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone="accent">{pattern.type === "cross_doc" ? "cross-document match · FR-50" : `repeated flag ×${pattern.cluster.length} · FR-51`}</Chip>
        <span className="ml-auto font-mono text-[10px] text-ink-faint">{formatDate(s.generated_at)}</span>
      </div>

      {pattern.type === "repeated_question" && pattern.cluster.length > 0 && (
        <details className="mt-2.5">
          <summary className="cursor-pointer text-xs font-medium text-ink-soft hover:text-ink">
            Flagged {pattern.cluster.length}× — “{s.canonical_question.split(":").pop()?.slice(0, 80) ?? s.canonical_question.slice(0, 80)}”
          </summary>
          <ul className="mt-2 space-y-1.5 border-l-2 border-line pl-3">
            {pattern.cluster.map((q) => (
              <li key={q.query_log_id} className="text-[11px] leading-relaxed text-ink-soft">
                “{q.question_text}” <span className="text-ink-faint">— flagged answer: {q.answer_text.slice(0, 70)}…</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {pattern.type === "cross_doc" && (
        <p className="mt-2.5 text-xs leading-relaxed text-ink-soft">
          Similar passage found in another document ({Math.round((pattern.matches?.[0]?.similarity ?? 0) * 100)}% match).
        </p>
      )}

      {s.rationale && <p className="mt-2 text-[11px] italic leading-relaxed text-ink-faint">{s.rationale}</p>}

      <label className="mt-3 block text-xs font-medium">Suggested correction {(!s.suggested_text || s.suggested_text.length < 2) && <span className="font-normal text-ink-faint">(no auto-draft — write it below)</span>}</label>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={3}
        placeholder="State the corrected answer…"
        className="focus-ring mt-1 w-full resize-none rounded-xl border border-line-strong bg-bg px-3 py-2 text-[13px]"
      />

      {error && <p className="mt-1 text-xs text-danger">{error}</p>}

      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" variant="primary" disabled={busy || draft.trim().length < 2} onClick={() => void act("accept")}>
          <Check size={12} weight="bold" /> Accept → submit for approval
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act("dismiss")}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}

interface SuggestedPattern {
  type: "cross_doc" | "repeated_question";
  cluster: Array<{ query_log_id: string; question_text: string; answer_text: string }>;
  matches?: Array<{ document_id: string; similarity: number }>;
}

/* ------------------------------ Conflicts ------------------------------ */

function ConflictsTab({ conflicts, onChanged }: { conflicts: ConflictAlertDto[]; onChanged: () => void }) {
  if (conflicts.length === 0) {
    return (
      <EmptyState
        icon={<CheckCircle size={20} weight="light" />}
        title="No open conflicts"
        body="Crisp scans workspace documents after every ingestion for passages that contradict each other (FR-43). Run a scan manually above."
      />
    );
  }
  return (
    <div className="space-y-3">
      {conflicts.map((c) => (
        <ConflictCard key={c.id} conflict={c} onChanged={onChanged} />
      ))}
    </div>
  );
}

function ConflictCard({ conflict: c, onChanged }: { conflict: ConflictAlertDto; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);

  async function act(action: "resolve" | "dismiss") {
    setBusy(true);
    try {
      await api.resolveConflict(c.id, action);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-warn/30 bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone="warn"><Warning size={10} weight="fill" /> possible contradiction</Chip>
        <Chip>{Math.round(c.similarity * 100)}% similar passages</Chip>
        <span className="ml-auto font-mono text-[10px] text-ink-faint">detected {formatDate(c.detected_at)}</span>
      </div>

      {c.rationale && <p className="mt-2 rounded-lg bg-warn-soft/60 px-2.5 py-1.5 text-xs leading-relaxed text-warn">{c.rationale}</p>}

      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <div className="rounded-xl border border-line bg-bg/60 p-2.5">
          <p className="font-mono text-[9px] uppercase tracking-wider text-ink-faint">{c.document_a_id.slice(0, 18)}…</p>
          <p className="mt-1 line-clamp-4 text-xs leading-relaxed text-ink-soft">{c.passage_a_text}</p>
        </div>
        <div className="rounded-xl border border-line bg-bg/60 p-2.5">
          <p className="font-mono text-[9px] uppercase tracking-wider text-ink-faint">{c.document_b_id.slice(0, 18)}…</p>
          <p className="mt-1 line-clamp-4 text-xs leading-relaxed text-ink-soft">{c.passage_b_text}</p>
        </div>
      </div>

      <footer className="mt-3 flex items-center gap-2 border-t border-line pt-2.5">
        <Button size="sm" variant="primary" disabled={busy} onClick={() => void act("resolve")} title="Mark as handled once the source documents are fixed">
          <WarningCircle size={12} /> Resolve
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act("dismiss")} title="Not actually a contradiction">
          Not a conflict
        </Button>
      </footer>
    </div>
  );
}
