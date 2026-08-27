import { getWorkspace, listDocuments, listFlaggedLogsSince, rawQuery, rawQueryOne } from "./db";
import { clusterFlaggedQuestions } from "./suggestions";
import { config } from "./config";

/**
 * FR-52: per-workspace analytics — most-flagged documents, most-flagged
 * questions/topics, correction approval/rejection rates, and time-to-approval
 * trends — so admins can identify systematically unreliable source documents.
 */

export interface FlaggedDocCount {
  document_id: string;
  document_name: string;
  flags: number;
}

export interface FlaggedTopic {
  count: number;
  sample_question: string;
  questions: string[];
}

export interface ApprovalTrendPoint {
  week: string; // ISO date of week start
  avg_hours: number;
  approvals: number;
}

export interface WorkspaceAnalytics {
  workspace_id: string;
  workspace_name: string;
  totals: {
    queries: number;
    flagged_answers: number;
    corrections_submitted: number;
    pending: number;
    approved: number;
    rejected: number;
    retired_or_superseded: number;
    active_corrections: number;
    approval_rate: number | null; // approved / (approved + rejected)
    avg_time_to_approval_hours: number | null;
    documents: number;
    conflict_alerts_open: number;
  };
  most_flagged_documents: FlaggedDocCount[];
  most_flagged_topics: FlaggedTopic[];
  approval_trend_weekly: ApprovalTrendPoint[];
}

const FLAG_LOOKBACK_DAYS = 180;

export async function computeWorkspaceAnalytics(workspaceId: string): Promise<WorkspaceAnalytics> {
  const ws = await getWorkspace(workspaceId);

  const docs = await listDocuments(workspaceId);
  const docNames = new Map(docs.map((d) => [d.id, d.filename]));

  const counts = (await rawQueryOne(
    `SELECT
      COUNT(*) AS queries,
      SUM(CASE WHEN feedback_status = 'flagged' THEN 1 ELSE 0 END) AS flagged,
      SUM(CASE WHEN source_type = 'correction' THEN 1 ELSE 0 END) AS served_from_correction
     FROM query_logs WHERE workspace_id = ?`,
    [workspaceId]
  )) as { queries: number; flagged: number; served_from_correction: number };

  const correctionCounts = (await rawQueryOne(
    `SELECT
      COUNT(*) AS submitted,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
      SUM(CASE WHEN status IN ('retired','superseded') THEN 1 ELSE 0 END) AS retired,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS live
     FROM corrections WHERE workspace_id = ?`,
    [workspaceId]
  )) as {
    submitted: number;
    pending: number;
    active: number;
    rejected: number;
    retired: number;
    live: number;
  };

  // Approvals carry approved_at; time-to-approval trend bucketed by approval week.
  const approvedRows = await rawQuery<{ created_at: string; approved_at: string }>(
    `SELECT created_at, approved_at FROM corrections
     WHERE workspace_id = ? AND status = 'active' AND approved_at IS NOT NULL`,
    [workspaceId]
  );

  let avgHours: number | null = null;
  const weekly = new Map<string, { totalHours: number; n: number }>();
  for (const r of approvedRows) {
    const created = new Date(r.created_at.replace(" ", "T")).getTime();
    const approved = new Date(r.approved_at.replace(" ", "T")).getTime();
    if (!Number.isFinite(created) || !Number.isFinite(approved)) continue;
    const hours = Math.max(0, (approved - created) / 3_600_000);
    avgHours = avgHours === null ? hours : (avgHours + hours) / 2;
    const d = new Date(approved);
    d.setUTCDate(d.getUTCDate() - d.getUTCDay()); // week start (Sunday)
    const key = d.toISOString().slice(0, 10);
    const bucket = weekly.get(key) ?? { totalHours: 0, n: 0 };
    bucket.totalHours += hours;
    bucket.n += 1;
    weekly.set(key, bucket);
  }
  const trend: ApprovalTrendPoint[] = [...weekly.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([week, v]) => ({ week, avg_hours: Math.round((v.totalHours / v.n) * 10) / 10, approvals: v.n }));

  // Most-flagged documents over the lookback window.
  const since = new Date(Date.now() - FLAG_LOOKBACK_DAYS * 24 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 19);
  const flaggedLogs = await listFlaggedLogsSince(workspaceId, since);
  const perDoc = new Map<string, number>();
  for (const log of flaggedLogs) {
    try {
      const ids = JSON.parse(log.document_ids) as string[];
      for (const id of ids) if (docNames.has(id)) perDoc.set(id, (perDoc.get(id) ?? 0) + 1);
    } catch {
      /* malformed row */
    }
  }
  const mostFlaggedDocs: FlaggedDocCount[] = [...perDoc.entries()]
    .map(([document_id, flags]) => ({ document_id, document_name: docNames.get(document_id) ?? document_id, flags }))
    .sort((a, b) => b.flags - a.flags)
    .slice(0, 8);

  // Most-flagged question topics via the shared clustering util.
  const clusters = await clusterFlaggedQuestions(
    flaggedLogs.slice(0, 200).map((l) => ({
      query_log_id: l.id,
      question_text: l.question_text,
      answer_text: l.answer_text,
    })),
    Math.max(0.78, config.repeatedFlagClusterSimilarity)
  );
  const topics: FlaggedTopic[] = clusters
    .map((c) => ({
      count: c.logs.length,
      sample_question: c.logs[0].question_text,
      questions: c.logs.map((l) => l.question_text),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const openConflicts = (
    (await rawQueryOne<{ n: number }>(
      "SELECT COUNT(*) AS n FROM conflict_alerts WHERE workspace_id = ? AND status = 'open'",
      [workspaceId]
    ))?.n ?? 0
  );

  const decided = correctionCounts.active + correctionCounts.rejected;

  return {
    workspace_id: workspaceId,
    workspace_name: ws?.name ?? workspaceId,
    totals: {
      queries: counts.queries ?? 0,
      flagged_answers: counts.flagged ?? 0,
      corrections_submitted: correctionCounts.submitted ?? 0,
      pending: correctionCounts.pending ?? 0,
      approved: correctionCounts.active ?? 0,
      rejected: correctionCounts.rejected ?? 0,
      retired_or_superseded: correctionCounts.retired ?? 0,
      active_corrections: correctionCounts.live ?? 0,
      approval_rate: decided > 0 ? Math.round(((correctionCounts.active ?? 0) / decided) * 100) : null,
      avg_time_to_approval_hours: avgHours === null ? null : Math.round(avgHours * 10) / 10,
      documents: docs.length,
      conflict_alerts_open: openConflicts,
    },
    most_flagged_documents: mostFlaggedDocs,
    most_flagged_topics: topics,
    approval_trend_weekly: trend,
  };
}
