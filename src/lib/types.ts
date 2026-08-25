export type DocumentStatus = "processing" | "ready" | "failed";
export type FeedbackStatus = "none" | "flagged" | "confirmed_correct";
export type SourceType = "document" | "correction" | "no_answer";
export type CorrectionStatus = "active" | "superseded" | "retired";
export type CorrectionScope = "document" | "workspace";

export interface Citation {
  document_id: string;
  document_name?: string;
  page: number;
  section_label?: string | null;
  chunk_id: string;
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
  created_at: string;
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
  created_at: string;
  updated_at: string;
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
