import clsx from "clsx";
import type { ReactNode } from "react";

type Tone = "neutral" | "accent" | "warn" | "danger";

const tones: Record<Tone, string> = {
  neutral: "border-line-strong bg-surface-2 text-ink-soft",
  accent: "border-accent-line bg-accent-soft text-accent-strong",
  warn: "border-warn/30 bg-warn-soft text-warn",
  danger: "border-danger/25 bg-danger-soft text-danger",
};

export function Chip({
  tone = "neutral",
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] leading-4",
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

export function StatusDot({ status }: { status: "processing" | "ready" | "failed" }) {
  return (
    <span className="relative flex h-1.5 w-1.5">
      {status === "processing" && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warn opacity-60" />
      )}
      <span
        className={clsx(
          "relative inline-flex h-1.5 w-1.5 rounded-full",
          status === "ready" && "bg-accent",
          status === "processing" && "bg-warn",
          status === "failed" && "bg-danger"
        )}
      />
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-3 py-16 text-center">
      <div className="grid h-11 w-11 place-items-center rounded-2xl border border-line bg-surface-2 text-ink-faint">
        {icon}
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-[13px] leading-relaxed text-ink-soft">{body}</p>
      </div>
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={`skeleton ${className ?? ""}`} />;
}
