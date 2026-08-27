"use client";

import { useState } from "react";
import { CheckCircle, Warning } from "@phosphor-icons/react";
import { api, type CorrectionDto } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

export interface CorrectionDraft {
  query_log_id: string;
  question_text: string;
  document_count: number;
}


export function CorrectionForm({
  draft,
  initialNote,
  onSuccess,
  onCancel,
}: {
  draft: CorrectionDraft;
  initialNote?: string;
  onSuccess?: () => void;
  onCancel: () => void;
}) {
  const [corrected, setCorrected] = useState("");
  const [note, setNote] = useState(initialNote ?? "");
  const [tags, setTags] = useState("");
  const [scope, setScope] = useState<"document" | "workspace">(draft.document_count === 1 ? "document" : "workspace");
  const [conflict, setConflict] = useState<CorrectionDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<null | { requiresApproval: boolean }>(null);

  async function submit(resolve?: "replace" | "annotate") {
    if (corrected.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.submitCorrection({
        query_log_id: draft.query_log_id,
        corrected_answer: corrected.trim(),
        note: note.trim() || null,
        scope,
        topic_tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        resolve,
      });
      if (res.conflict === true) {
        setConflict(res.existing);
      } else {
        setSaved({ requiresApproval: Boolean(res.requires_approval) });
        setTimeout(() => onSuccess?.(), saved?.requiresApproval ? 2600 : 1400);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save correction");
    } finally {
      setBusy(false);
    }
  }

  if (saved) {
    return (
      <div className="flex items-center gap-2.5 rounded-2xl border border-accent-line bg-accent-soft p-4">
        <CheckCircle size={18} weight="fill" className="shrink-0 text-accent" />
        <p className="text-[13px] leading-relaxed">
          {saved.requiresApproval ? (
            <>
              <span className="font-medium">Submitted for approval.</span> An Approver or Admin will review it in the
              queue — it goes live for everyone the moment it&apos;s approved.
            </>
          ) : (
            <>
              <span className="font-medium">Correction saved.</span> Matching future questions will now get this answer,
              labeled as a correction.
            </>
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-accent-line bg-surface p-4 shadow-[var(--shadow-card)]">
      <h3 className="text-sm font-semibold">Provide the correct answer</h3>
      <p className="mt-0.5 line-clamp-1 text-xs text-ink-faint" title={draft.question_text}>
        {draft.question_text}
      </p>

      {conflict && (
        <div className="mt-3 rounded-xl border border-warn/30 bg-warn-soft p-3">
          <div className="flex items-center gap-2 text-xs font-medium text-warn">
            <Warning size={13} weight="fill" /> Conflicting active correction exists
          </div>
          <p className="mt-1.5 line-clamp-2 rounded-lg bg-surface px-2.5 py-1.5 text-[11px] italic leading-relaxed text-ink-soft">
            “{conflict.corrected_answer_text}”
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => onCancel()} title="Do nothing — existing correction stays active">
              Keep existing
            </Button>
            <Button size="sm" variant="primary" disabled={busy} onClick={() => void submit("replace")}>
              Replace it
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void submit("annotate")} title="Keep both corrections active">
              Annotate both
            </Button>
          </div>
        </div>
      )}

      <div className="mt-3 space-y-3">
        <div>
          <label htmlFor="corr-answer" className="mb-1 block text-xs font-medium">
            Correct answer <span className="text-danger">*</span>
          </label>
          <textarea
            id="corr-answer"
            value={corrected}
            onChange={(e) => setCorrected(e.target.value)}
            rows={3}
            required
            placeholder="State the fact as it should be answered going forward…"
            className="focus-ring w-full resize-none rounded-xl border border-line-strong bg-bg px-3 py-2 text-[13px] placeholder:text-ink-faint"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="corr-note" className="mb-1 block text-xs font-medium">
              Note / source <span className="font-normal text-ink-faint">(optional)</span>
            </label>
            <input
              id="corr-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. per 2025 amendment, §12"
              className="focus-ring h-9 w-full rounded-xl border border-line-strong bg-bg px-3 text-[13px] placeholder:text-ink-faint"
            />
          </div>
          <div>
            <label htmlFor="corr-tags" className="mb-1 block text-xs font-medium">
              Topic keywords <span className="font-normal text-ink-faint">(comma-separated)</span>
            </label>
            <input
              id="corr-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="late filing, penalty"
              className="focus-ring h-9 w-full rounded-xl border border-line-strong bg-bg px-3 text-[13px] placeholder:text-ink-faint"
            />
          </div>
        </div>

        <fieldset>
          <legend className="mb-1.5 block text-xs font-medium">Applies to</legend>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { value: "document", label: "This document" },
                { value: "workspace", label: "Workspace-wide" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setScope(opt.value)}
                aria-pressed={scope === opt.value}
                className={cn(
                  "focus-ring rounded-lg border px-2.5 py-1.5 text-xs transition-colors duration-150",
                  scope === opt.value
                    ? "border-accent bg-accent-soft font-medium text-accent-strong"
                    : "border-line-strong text-ink-soft hover:border-ink-faint"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </fieldset>

        {error && <p className="text-xs text-danger">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" disabled={busy || corrected.trim().length < 2} onClick={() => void submit()}>
            {busy ? "Saving…" : conflict ? "Resolve & save" : "Save correction"}
          </Button>
        </div>
        {conflict && (
          <p className="text-right text-[10px] text-ink-faint">
            <Chip tone="warn" className="mr-1">audit trail kept</Chip>
            replaced corrections remain in history
          </p>
        )}
      </div>
    </div>
  );
}
