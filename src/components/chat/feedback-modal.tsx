"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowClockwise, PencilSimpleLine, X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";

export function FeedbackModal({
  question,
  retriesLeft,
  onTryAgain,
  onProvideCorrection,
  onClose,
}: {
  question: string;
  retriesLeft: number;
  onTryAgain: (whatWrong: string) => void;
  onProvideCorrection: (whatWrong: string) => void;
  onClose: () => void;
}) {
  const [whatWrong, setWhatWrong] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="Report a wrong answer"
    >
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">This answer is wrong</h2>
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ink-soft">{question}</p>
          </div>
          <Button variant="ghost" size="sm" aria-label="Close" onClick={onClose}>
            <X size={13} weight="bold" />
          </Button>
        </div>

        <label htmlFor="what-wrong" className="mb-1.5 block text-xs font-medium">
          What&apos;s wrong? <span className="font-normal text-ink-faint">(optional)</span>
        </label>
        <textarea
          id="what-wrong"
          ref={inputRef}
          value={whatWrong}
          onChange={(e) => setWhatWrong(e.target.value)}
          rows={3}
          placeholder="e.g. The penalty figure is outdated — it was amended."
          className="focus-ring w-full resize-none rounded-xl border border-line-strong bg-bg px-3 py-2 text-[13px] placeholder:text-ink-faint"
        />

        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {retriesLeft > 0 ? (
            <Button variant="primary" onClick={() => onTryAgain(whatWrong)}>
              <ArrowClockwise size={13} weight="bold" /> Try again ({retriesLeft} left)
            </Button>
          ) : (
            <span className="grid place-items-center rounded-xl border border-dashed border-line px-3 text-[11px] text-ink-faint">
              Retry limit reached
            </span>
          )}
          <Button variant={retriesLeft > 0 ? "secondary" : "primary"} onClick={() => onProvideCorrection(whatWrong)}>
            <PencilSimpleLine size={13} weight="fill" /> I know the correct answer
          </Button>
        </div>
      </div>
    </div>
  );
}
