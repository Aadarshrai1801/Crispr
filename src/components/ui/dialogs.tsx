"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "./button";
import { cn } from "@/lib/utils";

/**
 * In-app replacement for window.confirm/prompt/alert — everything stays inside
 * the app surface. Fire-and-forget promise API usable from anywhere:
 *   const ok = await confirmDialog({ title: "Delete?", danger: true });
 *   const reason = await promptDialog({ title: "Why?", input: { minLength: 3 } });
 */

export interface DialogOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  input?: {
    placeholder?: string;
    initialValue?: string;
    multiline?: boolean;
    /** Confirm stays disabled until the value is at least this long. */
    minLength?: number;
    hint?: string;
  };
}

interface DialogRequest extends DialogOptions {
  resolve: (value: string | null) => void;
}

let current: DialogRequest | null = null;
const listeners = new Set<(d: DialogRequest | null) => void>();

function emit() {
  for (const l of listeners) l(current);
}

function open(opts: DialogOptions): Promise<string | null> {
  return new Promise((resolve) => {
    // A second dialog replaces any pending one; resolve the old as cancelled.
    current?.resolve(null);
    current = { ...opts, resolve };
    emit();
  });
}

export function confirmDialog(opts: DialogOptions): Promise<boolean> {
  return open(opts).then((v) => v !== null);
}

export function promptDialog(opts: DialogOptions & { input: NonNullable<DialogOptions["input"]> }): Promise<string | null> {
  return open(opts);
}

export function alertDialog(opts: DialogOptions): Promise<void> {
  return open(opts).then(() => undefined);
}

function settle(value: string | null) {
  const d = current;
  current = null;
  emit();
  d?.resolve(value);
}

export function DialogHost() {
  const [dlg, setDlg] = useState<DialogRequest | null>(null);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const l = (d: DialogRequest | null) => setDlg(d);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  useEffect(() => {
    if (!dlg) return;
    setText(dlg.input?.initialValue ?? "");
    const t = setTimeout(() => (dlg.input ? inputRef.current?.focus() : undefined), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") settle(null);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
    };
  }, [dlg]);

  if (!dlg) return null;

  const min = dlg.input?.minLength ?? 0;
  const canConfirm = !dlg.input || text.trim().length >= min;

  function submit() {
    if (!canConfirm) return;
    settle(text.trim());
  }

  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/45 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && settle(null)}
      role="dialog"
      aria-modal="true"
      aria-label={dlg.title}
    >
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
        <h2 className={cn("text-sm font-semibold", dlg.danger && "text-danger")}>{dlg.title}</h2>
        {dlg.body && <p className="mt-1.5 whitespace-pre-line text-[13px] leading-relaxed text-ink-soft">{dlg.body}</p>}

        {dlg.input && (
          <div className="mt-3">
            {dlg.input.multiline ? (
              <textarea
                ref={(el) => {
                  inputRef.current = el;
                }}
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                placeholder={dlg.input.placeholder}
                className="focus-ring w-full resize-none rounded-xl border border-line-strong bg-bg px-3 py-2 text-[13px]"
              />
            ) : (
              <input
                ref={(el) => {
                  inputRef.current = el;
                }}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder={dlg.input.placeholder}
                className="focus-ring h-9 w-full rounded-xl border border-line-strong bg-bg px-3 text-[13px]"
              />
            )}
            {dlg.input.hint && <p className="mt-1.5 text-[11px] text-ink-faint">{dlg.input.hint}</p>}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => settle(null)}>
            {dlg.cancelLabel ?? "Cancel"}
          </Button>
          <Button
            variant={dlg.danger ? "danger" : "primary"}
            size="sm"
            disabled={!canConfirm}
            onClick={submit}
          >
            {dlg.confirmLabel ?? (dlg.input ? "Submit" : "Confirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}
