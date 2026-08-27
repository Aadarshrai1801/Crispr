"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowClockwise,
  CaretDown,
  Check,
  ChatCircleDots,
  ClockCounterClockwise,
  PencilSimple,
  SealCheck,
  ShieldWarning,
  Trash,
  XCircle,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { api, type CommentDto, type CorrectionDto, type DocumentDto } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Chip, EmptyState, Skeleton } from "@/components/ui/primitives";
import { confirmDialog, alertDialog } from "@/components/ui/dialogs";
import { cn, formatDate } from "@/lib/utils";

interface CorrectionWithHistory extends CorrectionDto {
  history?: CorrectionDto[];
  events?: Array<{
    id: string;
    action_type: string;
    actor_id: string;
    timestamp: string;
    after_state: string | null;
  }>;
}

function prettyAction(action: string): string {
  const label = action.replace(/^correction\./, "").replace(/_/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function eventTone(action: string): "accent" | "warn" | "danger" | "neutral" {
  if (action === "correction.approved") return "accent";
  if (action === "correction.rejected") return "danger";
  if (action === "correction.submitted") return "warn";
  return "neutral";
}

export default function CorrectionsPage() {
  const [corrections, setCorrections] = useState<CorrectionDto[] | null>(null);
  const [docs, setDocs] = useState<DocumentDto[]>([]);
  const [docFilter, setDocFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "pending" | "rejected" | "retired" | "superseded" | "review"
  >("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [histories, setHistories] = useState<Record<string, CorrectionWithHistory[]>>({});
  const [events, setEvents] = useState<Record<string, CorrectionWithHistory["events"]>>({});
  const [editing, setEditing] = useState<CorrectionDto | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const reduce = useReducedMotion();

  async function load() {
    const [cs, ds] = await Promise.all([api.corrections(), api.listDocuments()]);
    setCorrections(cs);
    setDocs(ds);
  }

  useEffect(() => {
    void load().catch(() => setCorrections([]));
  }, []);

  const nameById = useMemo(
    () => Object.fromEntries(docs.map((d) => [d.id, d.filename.replace(/\.[a-z0-9]+$/i, "")])),
    [docs]
  );

  const filtered = useMemo(() => {
    if (!corrections) return null;
    return corrections.filter((c) => {
      if (statusFilter === "review") {
        if (!c.needs_version_review) return false;
      } else if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (docFilter === "workspace" && c.scope !== "workspace") return false;
      if (docFilter !== "all" && docFilter !== "workspace" && c.document_id !== docFilter) return false;
      if (query.trim()) {
        const q = query.toLowerCase();
        const haystack = `${c.question_text} ${c.corrected_answer_text} ${c.wrong_answer_text} ${c.note ?? ""} ${(c.topic_tags ?? []).join(" ")}`;
        if (!haystack.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [corrections, docFilter, statusFilter, query]);

  async function openHistory(c: CorrectionDto) {
    const key = expanded === c.id ? null : c.id;
    setExpanded(key);
    if (key) {
      try {
        const res = await fetch(`/api/corrections/${c.id}`);
        if (!res.ok) throw new Error("Failed to load history");
        const data = (await res.json()) as CorrectionWithHistory;
        setHistories((h) => ({ ...h, [c.id]: data.history ?? [c] }));
        setEvents((e) => ({ ...e, [c.id]: data.events ?? [] }));
      } catch {
        setHistories((h) => ({ ...h, [c.id]: [c] }));
      }
    }
  }

  async function retire(c: CorrectionDto) {
    const ok = await confirmDialog({
      title: "Retire this correction?",
      body: "Future queries will fall back to document-derived answers. This is recorded in the audit trail.",
      confirmLabel: "Retire",
      danger: true,
    });
    if (!ok) return;
    setBusyId(c.id);
    try {
      await api.editCorrection(c.id, { action: "retire" });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function reviewVersion(c: CorrectionDto, outcome: "keep" | "reflag") {
    setBusyId(c.id);
    try {
      await api.editCorrection(c.id, { action: outcome === "keep" ? "version_review_keep" : "version_review_reflag" });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function saveEdit(fields: { question_text: string; corrected_answer_text: string; note: string | null; topic_tags: string[] }) {
    if (!editing) return;
    setBusyId(editing.id);
    try {
      const updated = await api.editCorrection(editing.id, { action: "edit", ...fields });
      setNotice(
        (updated as CorrectionDto & { edit_pending_review?: boolean }).edit_pending_review
          ? "Edit submitted for approval — the current answer stays live until an Admin/Approver accepts it."
          : "Correction updated."
      );
      setEditing(null);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 md:px-8 md:py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Corrections</h1>
        <p className="mt-1 text-[13px] text-ink-soft">
          Every human fix persisted here overrides retrieval on matching future questions — and never touches the
          source PDF.
        </p>
      </header>

      {notice && (
        <div className="mb-4 rounded-xl border border-accent-line bg-accent-soft p-3 text-[13px] text-accent-strong">
          {notice}
        </div>
      )}

      {/* Filters */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search questions, answers, notes…"
          aria-label="Search corrections"
          className="focus-ring h-9 w-full max-w-xs rounded-xl border border-line-strong bg-surface px-3 text-[13px] placeholder:text-ink-faint"
        />
        <select
          value={docFilter}
          onChange={(e) => setDocFilter(e.target.value)}
          aria-label="Filter by document"
          className="focus-ring h-9 rounded-xl border border-line-strong bg-surface px-2 text-xs"
        >
          <option value="all">All documents</option>
          <option value="workspace">Workspace-wide only</option>
          {docs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.filename}
            </option>
          ))}
        </select>
        <div className="flex gap-1">
          {(["all", "pending", "active", "rejected", "superseded", "retired", "review"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              aria-pressed={statusFilter === s}
              className={cn(
                "focus-ring rounded-lg px-2.5 py-1.5 text-xs capitalize transition-colors duration-150",
                statusFilter === s ? "bg-accent-soft font-medium text-accent-strong" : "text-ink-soft hover:bg-surface-hover"
              )}
            >
              {s === "review" ? "version review" : s}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {filtered === null ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<SealCheck size={20} weight="light" />}
          title="No corrections yet"
          body="When an answer is wrong, flag it in chat and provide the correct answer — it will appear and persist here."
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((c) => {
            const isOpen = expanded === c.id;
            const history = histories[c.id];
            const statusTone =
              c.status === "active" ? "accent" : c.status === "pending" ? "warn" : c.status === "rejected" ? "danger" : "neutral";
            return (
              <motion.div
                layout={!reduce}
                key={c.id}
                className={cn(
                  "rounded-2xl border bg-surface transition-colors duration-200",
                  ["active", "pending"].includes(c.status) ? "border-line" : "border-line opacity-70"
                )}
              >
                <div className="p-4">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Chip tone={statusTone}>{c.status}</Chip>
                    {c.status === "pending" && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-warn">
                        <ShieldWarning size={11} weight="fill" /> awaiting approval — not yet affecting retrieval
                      </span>
                    )}
                    {c.status === "rejected" && c.rejection_reason && (
                      <span className="text-[11px] text-danger" title={c.rejection_reason}>
                        rejected: {c.rejection_reason.slice(0, 60)}{c.rejection_reason.length > 60 ? "…" : ""}
                      </span>
                    )}
                    <Chip>{c.scope === "workspace" ? "workspace-wide" : nameById[c.document_id ?? ""] ?? "document"}</Chip>
                    {(c.topic_tags ?? []).map((t) => (
                      <Chip key={t}>{t}</Chip>
                    ))}
                    <span className="ml-auto font-mono text-[10px] text-ink-faint tabular-nums">
                      served {c.served_count} · confirmed {c.confirmed_count}
                    </span>
                  </div>

                  <p className="mt-2.5 text-[13px] font-medium leading-snug">{c.question_text}</p>

                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    <div className="rounded-xl border border-danger/20 bg-danger-soft/50 p-2.5">
                      <p className="font-mono text-[9px] uppercase tracking-wider text-danger">was</p>
                      <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-ink-soft">{c.wrong_answer_text}</p>
                    </div>
                    <div className="rounded-xl border border-accent-line bg-accent-soft p-2.5">
                      <p className="font-mono text-[9px] uppercase tracking-wider text-accent-strong">now</p>
                      <p className="mt-1 text-xs leading-relaxed text-ink">{c.corrected_answer_text}</p>
                    </div>
                  </div>

                  {c.note && <p className="mt-2 text-xs italic leading-relaxed text-ink-faint">Note: {c.note}</p>}

                  {/* Role-gated edit proposal pending review — previous answer stays live */}
                  {c.pending_edit && (
                    <div className="mt-2.5 flex flex-col gap-1.5 rounded-xl border border-warn/30 bg-warn-soft px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <PencilSimple size={13} weight="fill" className="text-warn" />
                        <p className="min-w-0 flex-1 text-[11px] leading-snug text-warn">
                          An edit to this correction is awaiting Admin/Approver review — the answer below is still the
                          live one.
                        </p>
                      </div>
                      {c.pending_edit.corrected_answer_text && (
                        <p className="text-[11px] leading-relaxed text-ink-soft">
                          Proposed: “{c.pending_edit.corrected_answer_text.slice(0, 160)}
                          {c.pending_edit.corrected_answer_text.length > 160 ? "…" : ""}”
                        </p>
                      )}
                    </div>
                  )}

                  {/* FR-39: version-update review banner */}
                  {c.needs_version_review === 1 && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-xl border border-warn/30 bg-warn-soft px-3 py-2">
                      <ShieldWarning size={13} weight="fill" className="text-warn" />
                      <p className="min-w-0 flex-1 text-[11px] leading-snug text-warn">
                        The source document was updated after this correction was made. Does it still apply?
                      </p>
                      <Button size="sm" disabled={busyId === c.id} onClick={() => void reviewVersion(c, "keep")}>
                        <Check size={11} weight="bold" /> Still applies
                      </Button>
                      <Button size="sm" disabled={busyId === c.id} onClick={() => void reviewVersion(c, "reflag")}>
                        Re-flag
                      </Button>
                    </div>
                  )}

                  <footer className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line pt-2.5">
                    <span className="text-[11px] text-ink-faint">
                      {c.status === "pending"
                        ? "submitted"
                        : c.status === "rejected"
                          ? "rejected"
                          : `live since ${formatDate(c.approved_at ?? c.created_at)}`}{" "}
                      · by {c.submitted_by.startsWith("user_") ? c.submitted_by.replace(/^user_/, "") : c.submitted_by}
                    </span>
                    <span className="ml-auto flex items-center gap-1">
                      {c.status === "active" && (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => setEditing(c)}>
                            <PencilSimple size={12} weight="light" /> {c.pending_edit ? "Edit (in review)" : "Edit"}
                          </Button>
                          <Button variant="ghost" size="sm" disabled={busyId === c.id} onClick={() => void retire(c)}>
                            <Trash size={12} weight="light" /> Retire
                          </Button>
                        </>
                      )}
                      <CommentToggle correctionId={c.id} />
                      <Button variant="ghost" size="sm" onClick={() => void openHistory(c)}>
                        <ClockCounterClockwise size={12} weight="light" />
                        History
                        <CaretDown size={10} className={cn("transition-transform duration-200", isOpen && "rotate-180")} />
                      </Button>
                    </span>
                  </footer>

                  <AnimatePresence initial={false}>
                    {isOpen && history && (
                      <motion.div
                        initial={reduce ? false : { opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                        className="overflow-hidden"
                      >
                        <ol className="mt-3 space-y-2 border-l-2 border-line pl-4">
                          {history.map((h, i) => (
                            <li key={h.id} className="relative text-xs leading-relaxed">
                              <span
                                className={cn(
                                  "absolute -left-[21px] top-1 h-2 w-2 rounded-full",
                                  i === 0 ? "bg-accent" : "bg-line-strong"
                                )}
                              />
                              {i === 0 ? (
                                <span className="text-ink-soft">
                                  Current version · saved {formatDate(h.created_at)}
                                  {h.status !== "active" && ` · ${h.status}`}
                                </span>
                              ) : (
                                <span className="text-ink-faint">
                                  Superseded version · {formatDate(h.created_at)} — “{h.corrected_answer_text.slice(0, 120)}
                                  {h.corrected_answer_text.length > 120 ? "…" : ""}”
                                </span>
                              )}
                            </li>
                          ))}
                          {history.length === 1 && (
                            <li className="text-ink-faint">No prior versions — this is the original correction.</li>
                          )}
                          {(events[c.id]?.length ?? 0) > 0 && (
                            <li className="pt-2">
                              <p className="mb-1.5 font-mono text-[9px] uppercase tracking-wider text-ink-faint">Lifecycle</p>
                              <ol className="space-y-1.5">
                                {(events[c.id] ?? []).map((ev) => (
                                  <li key={ev.id} className="flex flex-wrap items-baseline gap-x-2 text-[11px] leading-snug">
                                    <span className="font-mono text-[10px] text-ink-faint tabular-nums">{formatDate(ev.timestamp)}</span>
                                    <Chip tone={eventTone(ev.action_type)}>{prettyAction(ev.action_type)}</Chip>
                                    <span className="text-ink-faint">by {ev.actor_id.replace(/^user_/, "")}</span>
                                  </li>
                                ))}
                              </ol>
                            </li>
                          )}
                        </ol>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Edit modal */}
      {editing && (
        <EditModal
          correction={editing}
          busy={busyId === editing.id}
          onSave={(fields) => void saveEdit(fields)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function CommentToggle({ correctionId }: { correctionId: string }) {
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState<CommentDto[] | null>(null);
  const [text, setText] = useState("");
  const reduce = useReducedMotion();

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      try {
        setComments(await api.comments(correctionId).then((r) => r.comments));
      } catch {
        setComments([]);
      }
    }
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => void toggle()}>
        <ChatCircleDots size={12} weight="light" />
        Discussion{comments ? ` (${comments.length})` : ""}
      </Button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={reduce ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="w-full overflow-hidden"
          >
            <div className="mt-1 space-y-2 rounded-xl bg-bg/60 p-3">
              {comments === null ? (
                <Skeleton className="h-12" />
              ) : comments.length === 0 ? (
                <p className="text-xs text-ink-faint">No discussion yet — visible to all workspace members.</p>
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
              <div className="flex gap-2">
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void post()}
                  placeholder="Add a comment…"
                  className="focus-ring h-8 flex-1 rounded-lg border border-line-strong bg-surface px-2.5 text-xs"
                />
                <Button size="sm" disabled={!text.trim()} onClick={() => void post()}>Post</Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );

  async function post() {
    if (!text.trim()) return;
    try {
      await api.addComment(correctionId, text.trim());
      setText("");
      setComments(await api.comments(correctionId).then((r) => r.comments));
    } catch (err) {
      void alertDialog({ title: "Comment failed", body: err instanceof Error ? err.message : "Could not post the comment." });
    }
  }
}

function EditModal({
  correction,
  busy,
  onSave,
  onClose,
}: {
  correction: CorrectionDto;
  busy: boolean;
  onSave: (fields: { question_text: string; corrected_answer_text: string; note: string | null; topic_tags: string[] }) => void;
  onClose: () => void;
}) {
  const [question, setQuestion] = useState(correction.question_text);
  const [answer, setAnswer] = useState(correction.corrected_answer_text);
  const [note, setNote] = useState(correction.note ?? "");
  const [tags, setTags] = useState((correction.topic_tags ?? []).join(", "));

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-lg rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Edit correction</h2>
          <Button variant="ghost" size="sm" aria-label="Close" onClick={onClose}>
            <XCircle size={13} />
          </Button>
        </div>

        <div className="space-y-3">
          <div>
            <label htmlFor="edit-q" className="mb-1 block text-xs font-medium">
              Question
            </label>
            <textarea
              id="edit-q"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={2}
              className="focus-ring w-full resize-none rounded-xl border border-line-strong bg-bg px-3 py-2 text-[13px]"
            />
          </div>
          <div>
            <label htmlFor="edit-a" className="mb-1 block text-xs font-medium">
              Corrected answer
            </label>
            <textarea
              id="edit-a"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              rows={4}
              className="focus-ring w-full resize-none rounded-xl border border-line-strong bg-bg px-3 py-2 text-[13px]"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="edit-n" className="mb-1 block text-xs font-medium">
                Note / source
              </label>
              <input
                id="edit-n"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="focus-ring h-9 w-full rounded-xl border border-line-strong bg-bg px-3 text-[13px]"
              />
            </div>
            <div>
              <label htmlFor="edit-t" className="mb-1 block text-xs font-medium">
                Topic keywords
              </label>
              <input
                id="edit-t"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                className="focus-ring h-9 w-full rounded-xl border border-line-strong bg-bg px-3 text-[13px]"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={busy || answer.trim().length < 2 || question.trim().length < 3}
              onClick={() =>
                onSave({
                  question_text: question.trim(),
                  corrected_answer_text: answer.trim(),
                  note: note.trim() || null,
                  topic_tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
                })
              }
            >
              <ArrowClockwise size={13} weight="bold" /> {busy ? "Re-indexing…" : "Save & re-index"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
