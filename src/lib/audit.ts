import { appendAudit, listAuditEntries } from "./db";
import { logger } from "./logger";
import type { AuditActionType } from "./types";

/**
 * FR-41: immutable, append-only audit trail for correction/approval activity.
 * Storage lives in its own table so high approval volume never contends with
 * the primary document store (PRD scalability note).
 */
export const audit = {
  write(
    workspaceId: string,
    actorId: string,
    action: AuditActionType,
    targetType: string,
    targetId: string,
    before?: unknown,
    after?: unknown
  ) {
    try {
      return appendAudit({
        workspace_id: workspaceId,
        actor_id: actorId,
        action_type: action,
        target_type: targetType,
        target_id: targetId,
        before_state: before,
        after_state: after,
      });
    } catch (err) {
      // Auditing must never break the primary action; surface loudly instead.
      logger.error({ err }, "failed to append audit entry");
      return undefined;
    }
  },

  list(workspaceId: string, limit = 1000, offset = 0) {
    return listAuditEntries(workspaceId, limit, offset);
  },

  toCsv(entries: ReturnType<typeof listAuditEntries>): string {
    const header = "id,timestamp,actor_id,action_type,target_type,target_id,before_state,after_state";
    const escape = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = entries.map((e) =>
      [e.id, e.timestamp, e.actor_id, e.action_type, e.target_type, e.target_id, e.before_state, e.after_state]
        .map(escape)
        .join(",")
    );
    return [header, ...rows].join("\n");
  },
};
