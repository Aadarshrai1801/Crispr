"use client";

import { useEffect, useState } from "react";
import { ArrowClockwise, ChartBar, FileText } from "@phosphor-icons/react";
import { api, type AnalyticsDto } from "@/lib/client/api";
import { useSession } from "@/lib/client/use-session";
import { Button } from "@/components/ui/button";
import { Chip, Skeleton } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

export default function AnalyticsPage() {
  const session = useSession();
  const [data, setData] = useState<AnalyticsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setBusy(true);
    api
      .analytics(session.workspaceId)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load analytics"))
      .finally(() => setBusy(false));
  };

  useEffect(() => {
    if (session.hydrated) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.hydrated, session.workspaceId]);

  if (error) {
    return (
      <div className="mx-auto max-w-[1100px] px-4 py-10 md:px-8">
        <div className="rounded-2xl border border-danger/25 bg-danger-soft p-4 text-[13px] text-danger">{error}</div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-8 md:px-8 md:py-10">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">Compounding intelligence</p>
          <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
          <p className="mt-1 text-[13px] text-ink-soft">Which documents are systematically unreliable — and how fast the team fixes them.</p>
        </div>
        <Button size="sm" disabled={busy} onClick={load}>
          <ArrowClockwise size={12} className={busy ? "animate-spin" : undefined} /> Refresh
        </Button>
      </header>

      {!data ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : (
        <AnalyticsBody data={data} />
      )}
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <p className="font-mono text-[9.5px] uppercase tracking-wider text-ink-faint">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] leading-snug text-ink-faint">{hint}</p>}
    </div>
  );
}

function AnalyticsBody({ data }: { data: AnalyticsDto }) {
  const t = data.totals;
  return (
    <div className="space-y-6">
      {/* Top-level metrics */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Queries" value={String(t.queries)} />
        <StatCard label="Flagged answers" value={String(t.flagged_answers)} />
        <StatCard label="Corrections submitted" value={String(t.corrections_submitted)} />
        <StatCard label="Approval rate" value={t.approval_rate === null ? "—" : `${t.approval_rate}%`} hint={`${t.approved} approved · ${t.rejected} rejected`} />
        <StatCard
          label="Avg time to approve"
          value={t.avg_time_to_approval_hours === null ? "—" : t.avg_time_to_approval_hours >= 24 ? `${(t.avg_time_to_approval_hours / 24).toFixed(1)}d` : `${Math.round(t.avg_time_to_approval_hours)}h`}
        />
        <StatCard label="Open conflicts" value={String(t.conflict_alerts_open)} />
      </div>
      <p className="-mt-4 flex flex-wrap items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
        pending {t.pending} · active corrections {t.active_corrections} · retired/superseded {t.retired_or_superseded} · documents {t.documents}
      </p>

      {/* Approval trend */}
      <section className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="text-sm font-semibold">Time-to-approval trend</h2>
        {data.approval_trend_weekly.length === 0 ? (
          <p className="mt-2 text-[13px] text-ink-soft">No approvals yet — trends appear once the queue starts moving.</p>
        ) : (
          <>
            <div className="mt-4 flex h-36 items-end gap-2">
              {(() => {
                const points = data.approval_trend_weekly;
                const max = Math.max(...points.map((p) => p.avg_hours), 1);
                return points.map((p) => (
                  <div key={p.week} className="flex min-w-0 flex-1 flex-col items-center gap-1.5" title={`week of ${p.week}: ${p.avg_hours}h avg across ${p.approvals} approval(s)`}>
                    <span className="font-mono text-[9px] tabular-nums text-ink-faint">{p.avg_hours >= 24 ? `${Math.round(p.avg_hours / 24)}d` : `${Math.round(p.avg_hours)}h`}</span>
                    <div
                      className={cn("w-full rounded-t-md transition-all duration-500", p.avg_hours <= 24 ? "bg-accent" : p.avg_hours <= 72 ? "bg-warn/70" : "bg-danger/60")}
                      style={{ height: `${Math.max((p.avg_hours / max) * 100, 4)}%` }}
                    />
                    <span className="truncate font-mono text-[8.5px] text-ink-faint">{p.week.slice(5)}</span>
                  </div>
                ));
              })()}
            </div>
            <p className="mt-2 text-[11px] text-ink-faint">Average hours from submission → approval, by week.</p>
          </>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Most-flagged documents */}
        <section className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><FileText size={14} /> Most-flagged documents</h2>
          {data.most_flagged_documents.length === 0 ? (
            <p className="mt-2 text-[13px] text-ink-soft">No flags recorded in the last 180 days.</p>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {data.most_flagged_documents.map((d) => {
                const max = Math.max(...data.most_flagged_documents.map((x) => x.flags));
                return (
                  <li key={d.document_id}>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="min-w-0 truncate font-medium" title={d.document_name}>{d.document_name.replace(/\.[a-z0-9]+$/i, "")}</span>
                      <span className="font-mono text-[10px] tabular-nums text-ink-faint">{d.flags} flag{d.flags === 1 ? "" : "s"}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                      <div className="h-full rounded-full bg-danger/50" style={{ width: `${(d.flags / max) * 100}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Most-flagged topics */}
        <section className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><ChartBar size={14} /> Most-flagged questions/topics</h2>
          {data.most_flagged_topics.length === 0 ? (
            <p className="mt-2 text-[13px] text-ink-soft">Clustered topics appear as flags accumulate.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {data.most_flagged_topics.map((topic, i) => (
                <li key={i} className="rounded-xl border border-line bg-bg/50 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-xs font-medium" title={topic.questions.join(" | ")}>{topic.sample_question}</p>
                    <Chip tone={topic.count >= 3 ? "warn" : "neutral"}>×{topic.count}</Chip>
                  </div>
                  {topic.count > 1 && (
                    <p className="mt-1 line-clamp-1 text-[10.5px] italic text-ink-faint" title={topic.questions.slice(1).join(" · ")}>
                      also phrased: {topic.questions.slice(1, 3).join(" · ")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
