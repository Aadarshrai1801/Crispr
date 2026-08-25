export interface DocumentDto {
  id: string;
  workspace_id: string;
  owner_id: string;
  filename: string;
  page_count: number;
  status: "processing" | "ready" | "failed";
  ocr_warning: number;
  error: string | null;
  created_at: string;
}

export interface CitationDto {
  document_id: string;
  document_name?: string;
  page: number;
  section_label?: string | null;
  chunk_id: string;
}

export interface QueryResultDto {
  query_log_id: string;
  question: string;
  answer: string;
  source_type: "document" | "correction" | "no_answer";
  citations: CitationDto[];
  groundedness: number;
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
}

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
  status: "active" | "superseded" | "retired";
  supersedes_correction_id: string | null;
  scope: "document" | "workspace";
  served_count: number;
  confirmed_count: number;
  created_at: string;
  updated_at: string;
}

async function handle<T>(res: Response): Promise<T> {
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
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

export const api = {
  listDocuments: () => fetch("/api/documents").then((r) => handle<DocumentDto[]>(r)),

  uploadDocument: (file: File, force = false) => {
    const form = new FormData();
    form.append("file", file);
    if (force) form.append("force", "true");
    return fetch("/api/documents", { method: "POST", body: form }).then((r) => handle<DocumentDto>(r));
  },

  deleteDocument: (id: string) => fetch(`/api/documents/${id}`, { method: "DELETE" }).then((r) => handle<{ ok: boolean }>(r)),

  ask: (question: string, documentIds: string[]) =>
    fetch("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, document_ids: documentIds }),
    }).then((r) => handle<QueryResultDto>(r)),

  retry: (queryLogId: string) => fetch(`/api/query/${queryLogId}/retry`, { method: "POST" }).then((r) => handle<QueryResultDto>(r)),

  originalAnswer: (question: string, documentIds: string[]) =>
    fetch("/api/query/original", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, document_ids: documentIds }),
    }).then((r) => handle<QueryResultDto>(r)),

  feedback: (queryLogId: string, verdict: "flagged" | "confirmed_correct", correctionId?: string) =>
    fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query_log_id: queryLogId, verdict, correction_id: correctionId }),
    }).then((r) => handle<{ ok: boolean }>(r)),

  corrections: (documentId?: string) => {
    const qs = documentId ? `?document_id=${encodeURIComponent(documentId)}` : "";
    return fetch(`/api/corrections${qs}`).then((r) => handle<CorrectionDto[]>(r));
  },

  submitCorrection: (input: {
    query_log_id: string;
    corrected_answer: string;
    note?: string | null;
    scope?: "document" | "workspace";
    topic_tags?: string[];
    resolve?: "replace" | "annotate" | "keep";
  }) =>
    fetch("/api/corrections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }).then(
      (
        r
      ) =>
        handle<
          { conflict: false; correction: CorrectionDto } | { conflict: true; message: string; existing: CorrectionDto }
        >(r)
    ),

  editCorrection: (
    id: string,
    fields: {
      action: "edit" | "retire";
      question_text?: string;
      corrected_answer_text?: string;
      note?: string | null;
      topic_tags?: string[];
      scope?: "document" | "workspace";
    }
  ) =>
    fetch(`/api/corrections/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    }).then((r) => handle<CorrectionDto>(r)),
};
