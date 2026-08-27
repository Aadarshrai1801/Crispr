import type { ChatMessageRow, ChatSessionRow } from "./types";

/**
 * Serialization helpers for the persistent chat layer (Phase 1 of the
 * persistence/enterprise plan). DTO shapes are hand-rolled here (not zod-derived)
 * so both API routes and the client share a single source of truth.
 */

export interface ChatSessionDto {
  id: string;
  user_id: string;
  workspace_id: string;
  title: string;
  document_ids: string[];
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
  /** User messages: { question }. Assistant messages: { result }. */
  content: unknown;
  query_log_id: string | null;
  created_at: string;
}

export interface ChatSessionDetailDto extends ChatSessionDto {
  messages: ChatMessageDto[];
}

export function serializeSession(row: ChatSessionRow, messageCount = 0): ChatSessionDto {
  let document_ids: string[] = [];
  try {
    document_ids = JSON.parse(row.document_ids);
  } catch {
    /* ignore malformed */
  }
  return {
    id: row.id,
    user_id: row.user_id,
    workspace_id: row.workspace_id,
    title: row.title,
    document_ids,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_message_at: row.last_message_at,
    message_count: messageCount,
  };
}

export function serializeMessage(row: ChatMessageRow): ChatMessageDto {
  let content: unknown = {};
  try {
    content = JSON.parse(row.content);
  } catch {
    content = { raw: row.content };
  }
  return {
    id: row.id,
    session_id: row.session_id,
    role: row.role,
    content,
    query_log_id: row.query_log_id,
    created_at: row.created_at,
  };
}
