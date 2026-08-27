export type ChatSessionStatus = "active" | "archived";

export interface ChatSessionRow {
  id: string;
  user_id: string;
  workspace_id: string;
  title: string;
  document_ids: string; // JSON string[]
  status: ChatSessionStatus;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
}

export type ChatMessageRole = "user" | "assistant";

/**
 * Durable, user-facing conversational message. `content` is a JSON blob whose
 * shape depends on `role`: user messages store `{ question: string }`, assistant
 * messages store `{ result: QueryResultDto }`. `query_log_id` links assistant
 * messages to their internal QueryLog row (the retrieval system-of-record).
 */
export interface ChatMessageRow {
  id: string;
  session_id: string;
  role: ChatMessageRole;
  content: string; // JSON blob (see ChatSessionRow doc)
  query_log_id: string | null;
  created_at: string;
}

export type DocumentStatus = "processing" | "ready" | "failed";
export type FeedbackStatus = "none" | "flagged" | "confirmed_correct";
export type SourceType = "document" | "correction" | "no_answer";
/** v2: pending/rejected added for approval workflows (FR-33). `active` == approved & live. */
export type CorrectionStatus = "active" | "superseded" | "retired" | "pending" | "rejected";
export type CorrectionScope = "document" | "workspace";
export type WorkspaceRole = "Admin" | "Approver" | "Contributor" | "Viewer";
export type PlanTier = "free" | "pro" | "team" | "enterprise";
export type DocumentSourceType = "upload" | "gdrive" | "notion" | "confluence" | "sharepoint";
export type IntegrationProvider =
  | "slack"
  | "teams"
  | "gdrive"
  | "notion"
  | "confluence"
  | "sharepoint"
  | "zapier";

export interface Citation {
  document_id: string;
  document_name?: string;
  page: number;
  section_label?: string | null;
  chunk_id: string;
}

export interface ConfidenceScore {
  /** 0..1 */
  score: number;
  threshold: number;
  flagged_needs_review: boolean;
}

export interface UserRow {
  id: string;
  name: string;
  email: string;
}

export interface WorkspaceRow {
  id: string;
  name: string;
  owner_id: string;
  member_ids: string; // legacy JSON array (v1); authoritative membership lives in workspace_members
  approval_required: number; // boolean
  confidence_threshold: number;
  plan_tier: PlanTier;
  created_at: string;
}

export interface WorkspaceMembershipRow {
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  joined_at: string;
}

export interface DocumentRow {
  id: string;
  workspace_id: string;
  owner_id: string;
  filename: string;
  storage_path: string;
  page_count: number;
  status: DocumentStatus;
  file_hash: string;
  ocr_warning: number;
  error: string | null;
  source_type: DocumentSourceType;
  source_connection_id: string | null;
  current_version_id: string | null;
  version_number: number;
  created_at: string;
}

export interface DocumentVersionRow {
  id: string;
  document_id: string;
  version_number: number;
  uploaded_at: string;
  uploaded_by: string;
  diff_summary: string | null; // JSON {added[],removed[],modified[],stats}
  storage_path: string;
  file_hash: string;
  page_count: number;
}

export interface QueryLogRow {
  id: string;
  workspace_id: string;
  user_id: string;
  document_ids: string; // JSON array
  question_text: string;
  answer_text: string;
  source_type: SourceType;
  citations: string; // JSON Citation[]
  correction_id: string | null;
  feedback_status: FeedbackStatus;
  retry_of: string | null;
  attempt: number;
  strategy_note: string;
  confidence_score: number | null;
  confidence_threshold: number | null;
  flagged_needs_review: number; // boolean
  created_at: string;
}

export interface CorrectionRow {
  id: string;
  workspace_id: string;
  document_id: string | null;
  original_query_log_id: string;
  question_text: string;
  topic_tags: string; // JSON string[]
  wrong_answer_text: string;
  corrected_answer_text: string;
  note: string | null;
  submitted_by: string;
  status: CorrectionStatus;
  supersedes_correction_id: string | null;
  scope: CorrectionScope;
  served_count: number;
  confirmed_count: number;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  needs_version_review: number; // boolean (FR-39)
  suggested_correction_id: string | null;
  /** JSON-encoded proposed edit awaiting Approver/Admin review (role-gated edits). */
  pending_edit: string | null;
  pending_edit_by: string | null;
  pending_edit_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CorrectionCommentRow {
  id: string;
  correction_id: string;
  author_id: string;
  body: string;
  created_at: string;
}

export type AuditActionType =
  | "correction.submitted"
  | "correction.approved"
  | "correction.rejected"
  | "correction.edited"
  | "correction.deleted"
  | "correction.retired"
  | "correction.edit_proposed"
  | "correction.edit_approved"
  | "correction.edit_rejected"
  | "correction.superseded"
  | "comment.added"
  | "member.added"
  | "member.role_changed"
  | "member.removed"
  | "workspace.created"
  | "workspace.updated"
  | "document.uploaded"
  | "document.version_updated"
  | "document.deleted"
  | "conflict.detected"
  | "conflict.resolved"
  | "conflict.dismissed"
  | "suggestion.accepted"
  | "suggestion.dismissed"
  | "apikey.created"
  | "apikey.revoked"
  | "integration.connected"
  | "integration.disconnected";

export interface AuditLogEntryRow {
  id: string;
  workspace_id: string;
  actor_id: string;
  action_type: AuditActionType;
  target_type: string;
  target_id: string;
  before_state: string | null; // JSON
  after_state: string | null; // JSON
  timestamp: string;
}

export interface ConflictAlertRow {
  id: string;
  workspace_id: string;
  document_a_id: string;
  passage_a_ref: string; // chunk id
  passage_a_text: string;
  document_b_id: string;
  passage_b_ref: string; // chunk id
  passage_b_text: string;
  similarity: number;
  rationale: string | null;
  status: "open" | "resolved" | "dismissed";
  detected_at: string;
}

export interface IntegrationConnectionRow {
  id: string;
  workspace_id: string;
  provider: IntegrationProvider;
  display_name: string;
  auth_credentials: string | null; // encrypted JSON
  sync_status: "disconnected" | "connected" | "error" | "syncing";
  last_synced_at: string | null;
  created_at: string;
}

export interface ApiKeyRow {
  id: string;
  workspace_id: string;
  key_hash: string;
  key_prefix: string;
  scopes: string; // JSON string[]
  created_by: string;
  name: string;
  revoked_at: string | null;
  created_at: string;
}

export type SuggestedCorrectionSource =
  | { type: "cross_doc"; correction_id: string; matches: { document_id: string; chunk_id: string; page_number: number; text: string; similarity: number }[] }
  | { type: "repeated_question"; cluster: { query_log_id: string; question_text: string; answer_text: string }[] };

export interface SuggestedCorrectionRow {
  id: string;
  workspace_id: string;
  source_pattern: string; // JSON SuggestedCorrectionSource
  canonical_question: string;
  suggested_text: string;
  rationale: string | null;
  status: "pending" | "accepted" | "dismissed";
  generated_at: string;
}

export interface WebhookEndpointRow {
  id: string;
  workspace_id: string;
  url: string;
  secret: string;
  events: string; // JSON string[]
  active: number; // boolean
  created_at: string;
}

export interface RetrievedChunk {
  chunk_id: string;
  document_id: string;
  page_number: number;
  section_label: string | null;
  text: string;
  score: number;
}

export interface QueryResultPayload {
  query_log_id: string;
  question: string;
  answer: string;
  source_type: SourceType;
  citations: Citation[];
  groundedness: number;
  confidence: ConfidenceScore;
  correction: null | {
    id: string;
    corrected_answer_text: string;
    wrong_answer_text: string;
    note: string | null;
    submitted_by: string;
    created_at: string;
    similarity: number;
    needs_confirmation: boolean;
  };
  attempt: number;
  strategy_note: string;
  narrowed_search?: boolean;
}

export const WORKSPACE_ROLES: WorkspaceRole[] = ["Admin", "Approver", "Contributor", "Viewer"];
