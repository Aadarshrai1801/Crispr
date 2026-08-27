export interface DocumentDto {
  id: string;
  workspace_id: string;
  owner_id: string;
  filename: string;
  page_count: number;
  status: "processing" | "ready" | "failed";
  ocr_warning: number;
  error: string | null;
  source_type: string;
  current_version_id: string | null;
  version_number: number;
  created_at: string;
}

export interface CitationDto {
  document_id: string;
  document_name?: string;
  page: number;
  section_label?: string | null;
  chunk_id: string;
}

export interface ConfidenceDto {
  score: number;
  threshold: number;
  flagged_needs_review: boolean;
}

export interface QueryResultDto {
  query_log_id: string;
  question: string;
  answer: string;
  source_type: "document" | "correction" | "no_answer";
  citations: CitationDto[];
  groundedness: number;
  confidence?: ConfidenceDto;
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

export type CorrectionStatusDto = "active" | "superseded" | "retired" | "pending" | "rejected";

export interface CorrectionDto {
  id: string;
  workspace_id: string;
  document_id: string | null;
  original_query_log_id: string;
  question_text: string;
  topic_tags: string[];
  wrong_answer_text: string;
  corrected_answer_text: string;
  note: string | null;
  submitted_by: string;
  status: CorrectionStatusDto;
  supersedes_correction_id: string | null;
  scope: "document" | "workspace";
  served_count: number;
  confirmed_count: number;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  needs_version_review: number;
  /** Proposed edit awaiting review — present only on corrections with a role-gated edit in flight. */
  pending_edit?: {
    question_text?: string;
    corrected_answer_text?: string;
    note?: string | null;
    topic_tags?: string[];
    scope?: "document" | "workspace";
    document_id?: string | null;
  } | null;
  pending_edit_by?: string | null;
  pending_edit_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserDto {
  id: string;
  name: string;
  email: string;
}

export interface WorkspaceDto {
  id: string;
  name: string;
  owner_id: string;
  approval_required: number;
  confidence_threshold: number;
  plan_tier: "free" | "pro" | "team" | "enterprise";
  created_at: string;
}

export interface MemberDto {
  workspace_id: string;
  user_id: string;
  role: "Admin" | "Approver" | "Contributor" | "Viewer";
  joined_at: string;
  name: string;
  email: string;
}

export interface CommentDto {
  id: string;
  correction_id: string;
  author_id: string;
  body: string;
  created_at: string;
}

export interface AuditEntryDto {
  id: string;
  workspace_id: string;
  actor_id: string;
  action_type: string;
  target_type: string;
  target_id: string;
  before_state: string | null;
  after_state: string | null;
  timestamp: string;
}

export interface ConflictAlertDto {
  id: string;
  workspace_id: string;
  document_a_id: string;
  passage_a_ref: string;
  passage_a_text: string;
  document_b_id: string;
  passage_b_ref: string;
  passage_b_text: string;
  similarity: number;
  rationale: string | null;
  status: "open" | "resolved" | "dismissed";
  detected_at: string;
}

export interface SuggestedCorrectionDto {
  id: string;
  workspace_id: string;
  source_pattern: string;
  canonical_question: string;
  suggested_text: string;
  rationale: string | null;
  status: "pending" | "accepted" | "dismissed";
  generated_at: string;
}

export interface ChatSessionDto {
  id: string;
  user_id: string;
  workspace_id: string;
  title: string;
  document_ids: string[]; // parsed
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  message_count: number;
}

export interface ChatMessageDto {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  /** User messages: { question }. Assistant messages: { result: QueryResultDto }. */
  content: { question?: string } | { result: QueryResultDto };
  query_log_id: string | null;
  created_at: string;
}

export interface ChatSessionDetailDto extends ChatSessionDto {
  messages: ChatMessageDto[];
}

export interface ApiKeyDto {
  id: string;
  workspace_id: string;
  key_hash: string;
  key_prefix: string;
  scopes: string; // JSON
  created_by: string;
  name: string;
  revoked_at: string | null;
  created_at: string;
}

export interface WebhookEndpointDto {
  id: string;
  workspace_id: string;
  url: string;
  events: string; // JSON
  active: number;
  created_at: string;
}

export interface IntegrationConnectionDto {
  id: string;
  workspace_id: string;
  provider: string;
  display_name: string;
  sync_status: string;
  last_synced_at: string | null;
  created_at: string;
}

export interface VersionDiffSummary {
  added: string[];
  removed: string[];
  modified: string[];
  stats: { previous_version: number; pages_before: number; pages_after: number; material_changes: number };
}

/* ------------------------- request plumbing ------------------------- */

function headers(): Record<string, string> {
  const h: Record<string, string> = {};
  try {
    // Identity travels via the HttpOnly session cookie now (blocker #1);
    // this header only selects the active workspace target.
    const w = localStorage.getItem("crisp-active-workspace");
    if (w) h["x-crisp-workspace-id"] = w;
  } catch {
    /* ignore */
  }
  return h;
}

async function handle<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const body = data as { message?: string; error?: string };
    const err = new Error(body.message || body.error || `Request failed (${res.status})`) as Error & {
      status?: number;
      payload?: unknown;
    };
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data as T;
}

function request(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(path, { ...init, headers: { ...headers(), ...(init.headers ?? {}) } }).then((res) => {
    // Blocker #1 UX: an expired/missing session bounces to the login screen,
    // except for the auth endpoints themselves which report inline.
    if (
      res.status === 401 &&
      typeof window !== "undefined" &&
      !path.startsWith("/api/auth")
    ) {
      window.location.href = "/login";
    }
    return res;
  });
}

function jsonRequest<T>(path: string, method: string, body?: unknown): Promise<T> {
  return request(path, {
    method,
    ...(body !== undefined && body !== null
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  }).then((r) => handle<T>(r));
}

export const api = {
  /* ---- auth ---- */
  login: (email: string, password: string) =>
    jsonRequest<SessionPayload>("/api/auth/login", "POST", { email, password }),
  devLoginAs: (userId: string) =>
    jsonRequest<SessionPayload>("/api/auth/login", "POST", { user_id: userId }),
  logout: () => request("/api/auth/logout", { method: "POST" }).then((r) => handle<{ ok: boolean }>(r)),
  session: () => jsonRequest<SessionPayload & { dev_impersonation?: boolean }>("/api/auth/session", "GET"),

  /* ---- session ---- */
  users: () => jsonRequest<{ users: UserDto[] }>("/api/v2/users", "GET"),
  workspaces: () =>
    request(`/api/v2/workspaces`)
      .then((r) => handle<{ workspaces: WorkspaceDto[] }>(r)),
  createWorkspace: (input: { name: string; approval_required?: boolean; plan_tier?: string }) =>
    jsonRequest<{ workspace: WorkspaceDto }>("/api/v2/workspaces", "POST", input),
  updateWorkspace: (id: string, patch: Partial<{ name: string; approval_required: boolean; confidence_threshold: number; plan_tier: string }>) =>
    jsonRequest<{ workspace: WorkspaceDto }>(`/api/v2/workspaces/${id}`, "PATCH", patch),
  deleteWorkspace: (id: string) =>
    jsonRequest<{ ok: boolean }>(`/api/v2/workspaces/${id}`, "DELETE"),
  members: (wsId: string) => jsonRequest<{ members: MemberDto[] }>(`/api/v2/workspaces/${wsId}/members`, "GET"),
  addMember: (wsId: string, userId: string, role: string) =>
    jsonRequest<{ member: MemberDto }>(`/api/v2/workspaces/${wsId}/members`, "POST", { user_id: userId, role }),
  changeRole: (wsId: string, userId: string, role: string) =>
    jsonRequest<{ member: MemberDto }>(`/api/v2/workspaces/${wsId}/members/${userId}`, "PATCH", { role }),
  removeMember: (wsId: string, userId: string) =>
    jsonRequest<{ ok: boolean }>(`/api/v2/workspaces/${wsId}/members/${userId}`, "DELETE"),

  /* ---- documents ---- */
  listDocuments: () => request("/api/documents").then((r) => handle<DocumentDto[]>(r)),
  uploadDocument: (file: File, force = false) => {
    const form = new FormData();
    form.append("file", file);
    if (force) form.append("force", "true");
    return fetch("/api/documents", { method: "POST", body: form, headers: headers() }).then((r) => handle<DocumentDto>(r));
  },
  uploadNewVersion: (documentId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return fetch(`/api/documents/${documentId}/version`, { method: "POST", body: form, headers: headers() }).then((r) =>
      handle<{
        version: { id: string; version_number: number };
        diff_summary: VersionDiffSummary;
        corrections_needing_review: Array<{ id: string; question_text: string }>;
      }>(r)
    );
  },
  deleteDocument: (id: string) => request(`/api/documents/${id}`, { method: "DELETE" }).then((r) => handle<{ ok: boolean }>(r)),
  fetchUrl: (url: string) => jsonRequest<DocumentDto & { already_ingested?: boolean }>("/api/documents/fetch-url", "POST", { url }),

  /* ---- query ---- */
  ask: (question: string, documentIds: string[]) =>
    jsonRequest<QueryResultDto>("/api/query", "POST", { question, document_ids: documentIds }),
  askWorkspaceWide: (question: string) =>
    jsonRequest<QueryResultDto>("/api/query", "POST", { question, workspace_wide: true }),
  retry: (queryLogId: string) => request(`/api/query/${queryLogId}/retry`, { method: "POST" }).then((r) => handle<QueryResultDto>(r)),
  originalAnswer: (question: string, documentIds: string[]) =>
    jsonRequest<QueryResultDto>("/api/query/original", "POST", { question, document_ids: documentIds }),

  feedback: (queryLogId: string, verdict: "flagged" | "confirmed_correct", correctionId?: string) =>
    jsonRequest<{ ok: boolean }>("/api/feedback", "POST", { query_log_id: queryLogId, verdict, correction_id: correctionId }),

  /* ---- persistent chat sessions (Phase 1) ---- */
  listChatSessions: () => request("/api/chats").then((r) => handle<{ sessions: ChatSessionDto[] }>(r)),
  createChatSession: (input: { title?: string; document_ids?: string[] }) =>
    jsonRequest<{ session: ChatSessionDto }>("/api/chats", "POST", input),
  getChatSession: (id: string) =>
    request(`/api/chats/${encodeURIComponent(id)}`).then((r) => handle<{ session: ChatSessionDetailDto }>(r)),
  appendChatMessages: (id: string, messages: Array<{ role: "user" | "assistant"; content: unknown; query_log_id?: string | null }>) =>
    jsonRequest<{ session: ChatSessionDto; message_count: number }>(`/api/chats/${encodeURIComponent(id)}/messages`, "POST", { messages }),
  renameChatSession: (id: string, title: string) =>
    jsonRequest<{ session: ChatSessionDto }>(`/api/chats/${encodeURIComponent(id)}`, "PATCH", { title }),
  deleteChatSession: (id: string) =>
    request(`/api/chats/${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) => handle<{ ok: boolean }>(r)),

  /* ---- corrections ---- */
  corrections: (documentId?: string) => {
    const qs = documentId ? `?document_id=${encodeURIComponent(documentId)}` : "";
    return request(`/api/corrections${qs}`).then((r) => handle<CorrectionDto[]>(r));
  },
  submitCorrection: (input: {
    query_log_id: string;
    corrected_answer: string;
    note?: string | null;
    scope?: "document" | "workspace";
    topic_tags?: string[];
    resolve?: "replace" | "annotate" | "keep";
  }) =>
    jsonRequest<
      | { conflict: false; correction: CorrectionDto; requires_approval?: boolean }
      | { conflict: true; message: string; existing: CorrectionDto }
    >("/api/corrections", "POST", input),
  editCorrection: (
    id: string,
    fields:
      | { action: "edit"; question_text?: string; corrected_answer_text?: string; note?: string | null; topic_tags?: string[]; scope?: "document" | "workspace" }
      | { action: "retire" }
      | { action: "version_review_keep" }
      | { action: "version_review_reflag" }
  ) => jsonRequest<CorrectionDto>(`/api/corrections/${id}`, "PATCH", fields),

  pendingCorrections: (workspaceId: string) =>
    jsonRequest<{ corrections: CorrectionDto[]; edits: CorrectionDto[] }>(`/api/v2/corrections/pending?workspace_id=${encodeURIComponent(workspaceId)}`, "GET"),
  approveCorrection: (id: string, supersedeExisting = false) =>
    jsonRequest<{ correction: CorrectionDto }>(`/api/v2/corrections/${id}/approve`, "POST", { supersede_existing: supersedeExisting }),
  rejectCorrection: (id: string, reason: string) =>
    jsonRequest<{ correction: CorrectionDto }>(`/api/v2/corrections/${id}/reject`, "POST", { reason }),
  reviewCorrectionEdit: (id: string, decision: "accept" | "reject", reason?: string) =>
    jsonRequest<{ correction: CorrectionDto }>(`/api/v2/corrections/${id}/edit-review`, "POST", { decision, reason }),
  comments: (correctionId: string) =>
    jsonRequest<{ comments: CommentDto[] }>(`/api/v2/corrections/${correctionId}/comments`, "GET"),
  addComment: (correctionId: string, body: string) =>
    jsonRequest<{ comment: CommentDto }>(`/api/v2/corrections/${correctionId}/comments`, "POST", { body }),

  /* ---- audit / conflicts / suggestions / analytics ---- */
  auditLog: (wsId: string) =>
    jsonRequest<{ entries: AuditEntryDto[]; count: number }>(`/api/v2/workspaces/${wsId}/audit-log`, "GET"),
  conflicts: (wsId: string) =>
    jsonRequest<{ conflicts: ConflictAlertDto[] }>(`/api/v2/workspaces/${wsId}/conflicts`, "GET"),
  runConflictScan: (wsId: string) =>
    jsonRequest<{ result: { scanned_chunks: number; candidate_pairs: number; alerts_created: number; llm_verified: boolean } }>(
      `/api/v2/workspaces/${wsId}/conflicts`,
      "POST"
    ),
  resolveConflict: (id: string, action: "resolve" | "dismiss") =>
    jsonRequest<{ ok: boolean }>(`/api/v2/conflicts/${id}`, "PATCH", { action }),
  suggestions: (wsId: string) =>
    jsonRequest<{ suggestions: SuggestedCorrectionDto[] }>(`/api/v2/workspaces/${wsId}/suggestions`, "GET"),
  runFlagAnalysis: (wsId: string) =>
    jsonRequest<{ suggestions_created: number }>(`/api/v2/workspaces/${wsId}/suggestions`, "POST"),
  actOnSuggestion: (id: string, action: "accept" | "dismiss", correctedAnswer?: string) =>
    jsonRequest<{ correction?: CorrectionDto; dismissed?: boolean }>(`/api/v2/suggestions/${id}`, "POST", {
      action,
      ...(correctedAnswer ? { corrected_answer: correctedAnswer } : {}),
    }),
  analytics: (wsId: string) => request(`/api/v2/analytics/${encodeURIComponent(wsId)}`).then((r) => handle<AnalyticsDto>(r)),

  /* ---- api keys / webhooks / integrations ---- */
  apiKeys: (wsId: string) => request(`/api/v2/api-keys?workspace_id=${encodeURIComponent(wsId)}`).then((r) => handle<{ keys: ApiKeyDto[] }>(r)),
  createApiKey: (wsId: string, name: string, scopes: string[]) =>
    jsonRequest<{ key: ApiKeyDto; secret: string }>(`/api/v2/api-keys?workspace_id=${encodeURIComponent(wsId)}`, "POST", { name, scopes }),
  revokeApiKey: (keyId: string) => request(`/api/v2/api-keys/${keyId}?workspace_id=${localStorage.getItem("crisp-active-workspace") ?? ""}`, { method: "DELETE" }).then((r) => handle<{ ok: boolean }>(r)),
  webhooks: (wsId: string) => request(`/api/v2/workspaces/${wsId}/webhooks`).then((r) => handle<{ endpoints: WebhookEndpointDto[]; available_events: string[] }>(r)),
  createWebhook: (wsId: string, url: string, events: string[]) =>
    jsonRequest<{ endpoint: WebhookEndpointDto; secret: string }>(`/api/v2/workspaces/${wsId}/webhooks`, "POST", { url, events }),
  deleteWebhook: (wsId: string, hookId: string) =>
    request(`/api/v2/workspaces/${wsId}/webhooks/${hookId}`, { method: "DELETE" }).then((r) => handle<{ ok: boolean }>(r)),
  integrations: (wsId: string) =>
    request(`/api/v2/workspaces/${wsId}/integrations`).then((r) => handle<{ connections: IntegrationConnectionDto[] }>(r)),
  connectIntegration: (wsId: string, provider: string) =>
    jsonRequest<{ connection: IntegrationConnectionDto }>(`/api/v2/workspaces/${wsId}/integrations`, "POST", { provider }),
  disconnectIntegration: (wsId: string, provider: string) =>
    request(`/api/v2/workspaces/${wsId}/integrations?provider=${encodeURIComponent(provider)}`, { method: "DELETE" }).then((r) => handle<{ ok: boolean }>(r)),
};

export interface SessionPayload {
  user: UserDto;
  workspaces: WorkspaceDto[];
  workspaceId: string | null;
  role: string | null;
  dev_impersonation?: boolean;
}

export interface AnalyticsDto {
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
    approval_rate: number | null;
    avg_time_to_approval_hours: number | null;
    documents: number;
    conflict_alerts_open: number;
  };
  most_flagged_documents: Array<{ document_id: string; document_name: string; flags: number }>;
  most_flagged_topics: Array<{ count: number; sample_question: string; questions: string[] }>;
  approval_trend_weekly: Array<{ week: string; avg_hours: number; approvals: number }>;
}
