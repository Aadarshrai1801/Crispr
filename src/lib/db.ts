import { storageBackend } from "./config";
import * as local from "./db-local";
import * as supabase from "./db-supabase";

/**
 * Storage-backend facade.
 *
 * `local` (default) uses the synchronous SQLite driver; `supabase` uses the
 * async PostgreSQL + pgvector driver. Every data-access function here is async
 * so callers work identically against both backends. Local mode simply wraps
 * the sync SQLite read/write in a resolved promise; supabase mode performs a
 * real network query. Selection is driven by `storageBackend()` (see config).
 *
 * NOTE: In supabase mode, the relational schema must already exist (run
 * `src/lib/schema-pg.sql`). Authentication: server code uses the service-role
 * key, which bypasses RLS, so application authorization still governs access.
 */

const isSupabase = () => storageBackend() === "supabase";

export const DEV_SEED_PASSWORD = local.DEV_SEED_PASSWORD;

import type {
  NewWorkspaceInput,
  NewMembershipInput,
  NewDocumentInput,
  NewDocumentVersionInput,
  NewQueryLogInput,
  NewCorrectionInput,
  PendingEditPayload,
  NewAuditEntry,
  NewConflictAlert,
  UpsertConnectionInput,
  NewApiKeyInput,
  NewSuggestedCorrection,
  NewWebhookEndpoint,
  NewChatSessionInput,
  NewChatMessageInput,
} from "./db-local";

export type {
  SessionInfo,
  IngestJobRow,
  NewWorkspaceInput,
  NewMembershipInput,
  NewDocumentInput,
  NewDocumentVersionInput,
  NewQueryLogInput,
  NewCorrectionInput,
  PendingEditPayload,
  NewAuditEntry,
  NewConflictAlert,
  UpsertConnectionInput,
  NewApiKeyInput,
  NewSuggestedCorrection,
  NewWebhookEndpoint,
  NewChatSessionInput,
  NewChatMessageInput,
} from "./db-local";

export type {
  SessionInfo as SessionInfoPg,
  IngestJobRow as IngestJobRowPg,
  NewWorkspaceInput as NewWorkspaceInputPg,
  NewMembershipInput as NewMembershipInputPg,
  NewDocumentInput as NewDocumentInputPg,
  NewDocumentVersionInput as NewDocumentVersionInputPg,
  NewQueryLogInput as NewQueryLogInputPg,
  NewCorrectionInput as NewCorrectionInputPg,
  PendingEditPayload as PendingEditPayloadPg,
  NewAuditEntry as NewAuditEntryPg,
  NewConflictAlert as NewConflictAlertPg,
  UpsertConnectionInput as UpsertConnectionInputPg,
  NewApiKeyInput as NewApiKeyInputPg,
  NewSuggestedCorrection as NewSuggestedCorrectionPg,
  NewWebhookEndpoint as NewWebhookEndpointPg,
  NewChatSessionInput as NewChatSessionInputPg,
  NewChatMessageInput as NewChatMessageInputPg,
} from "./db-supabase";

/* ------------------------------------------------------------------ */

export async function getDb(): Promise<unknown> {
  return isSupabase() ? supabase.getDb() : local.getDb();
}

export async function defaultWorkspaceId(): Promise<string> {
  return isSupabase() ? supabase.defaultWorkspaceId() : Promise.resolve(local.defaultWorkspaceId());
}

/** Portable raw query (all rows). Params are positional `?`. */
export async function rawQuery<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return isSupabase() ? supabase.rawQuery<T>(sql, params) : Promise.resolve(local.rawQuery<T>(sql, params));
}

/** Portable raw query (first row). Params are positional `?`. */
export async function rawQueryOne<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  return isSupabase() ? supabase.rawQueryOne<T>(sql, params) : Promise.resolve(local.rawQueryOne<T>(sql, params));
}

/* ------------------------- Users ------------------------- */

export async function listUsers() {
  return isSupabase() ? supabase.listUsers() : Promise.resolve(local.listUsers());
}

export async function getUser(id: string) {
  return isSupabase() ? supabase.getUser(id) : Promise.resolve(local.getUser(id));
}

export async function getUserByEmail(email: string) {
  return isSupabase() ? supabase.getUserByEmail(email) : Promise.resolve(local.getUserByEmail(email));
}

/* ------------------------- Sessions ------------------------- */

export async function createSession(userId: string, ttlMs: number) {
  return isSupabase() ? supabase.createSession(userId, ttlMs) : Promise.resolve(local.createSession(userId, ttlMs));
}

export async function getSession(token: string) {
  return isSupabase() ? supabase.getSession(token) : Promise.resolve(local.getSession(token));
}

export async function deleteSession(token: string) {
  return isSupabase() ? supabase.deleteSession(token) : Promise.resolve(local.deleteSession(token));
}

/* ------------------------- Ingestion queue ------------------------- */

export async function enqueueIngestJob(documentId: string) {
  return isSupabase() ? supabase.enqueueIngestJob(documentId) : Promise.resolve(local.enqueueIngestJob(documentId));
}

export async function claimNextIngestJob() {
  return isSupabase() ? supabase.claimNextIngestJob() : Promise.resolve(local.claimNextIngestJob());
}

export async function completeIngestJob(jobId: string) {
  return isSupabase() ? supabase.completeIngestJob(jobId) : Promise.resolve(local.completeIngestJob(jobId));
}

export async function failIngestJob(jobId: string, error: string, willRetry: boolean) {
  return isSupabase()
    ? supabase.failIngestJob(jobId, error, willRetry)
    : Promise.resolve(local.failIngestJob(jobId, error, willRetry));
}

/* ------------------------- Workspaces ------------------------- */

export async function insertWorkspace(input: NewWorkspaceInput) {
  return isSupabase() ? supabase.insertWorkspace(input) : Promise.resolve(local.insertWorkspace(input));
}

export async function updateWorkspaceSettings(
  id: string,
  patch: Partial<Pick<WorkspaceRow, "name" | "confidence_threshold" | "plan_tier">> & { approval_required?: boolean }
) {
  return isSupabase()
    ? supabase.updateWorkspaceSettings(id, patch)
    : Promise.resolve(local.updateWorkspaceSettings(id, patch));
}

export async function getWorkspace(id: string) {
  return isSupabase() ? supabase.getWorkspace(id) : Promise.resolve(local.getWorkspace(id));
}

export async function listWorkspacesForUser(userId: string) {
  return isSupabase() ? supabase.listWorkspacesForUser(userId) : Promise.resolve(local.listWorkspacesForUser(userId));
}

/* ------------------------- Memberships ------------------------- */

export async function upsertMember(m: NewMembershipInput) {
  return isSupabase() ? supabase.upsertMember(m) : Promise.resolve(local.upsertMember(m));
}

export async function getMembership(workspaceId: string, userId: string) {
  return isSupabase() ? supabase.getMembership(workspaceId, userId) : Promise.resolve(local.getMembership(workspaceId, userId));
}

export async function listMembers(workspaceId: string) {
  return isSupabase() ? supabase.listMembers(workspaceId) : Promise.resolve(local.listMembers(workspaceId));
}

export async function removeMember(workspaceId: string, userId: string) {
  return isSupabase() ? supabase.removeMember(workspaceId, userId) : Promise.resolve(local.removeMember(workspaceId, userId));
}

export async function countMembers(workspaceId: string) {
  return isSupabase() ? supabase.countMembers(workspaceId) : Promise.resolve(local.countMembers(workspaceId));
}

export async function deleteWorkspaceCascade(workspaceId: string) {
  return isSupabase() ? supabase.deleteWorkspaceCascade(workspaceId) : Promise.resolve(local.deleteWorkspaceCascade(workspaceId));
}

/* ------------------------- Documents ------------------------- */

export async function insertDocument(doc: NewDocumentInput) {
  return isSupabase() ? supabase.insertDocument(doc) : Promise.resolve(local.insertDocument(doc));
}

export async function updateDocumentStatus(
  id: string,
  patch: Partial<Pick<DocumentRow, "status" | "page_count" | "error" | "current_version_id" | "version_number" | "filename" | "file_hash" | "storage_path">> & { ocr_warning?: boolean }
) {
  return isSupabase()
    ? supabase.updateDocumentStatus(id, patch)
    : Promise.resolve(local.updateDocumentStatus(id, patch));
}

export async function getDocument(id: string) {
  return isSupabase() ? supabase.getDocument(id) : Promise.resolve(local.getDocument(id));
}

export async function listDocuments(workspaceId: string) {
  return isSupabase() ? supabase.listDocuments(workspaceId) : Promise.resolve(local.listDocuments(workspaceId));
}

export async function countDocuments(workspaceId: string) {
  return isSupabase() ? supabase.countDocuments(workspaceId) : Promise.resolve(local.countDocuments(workspaceId));
}

export async function findDocumentByHash(hash: string, workspaceId?: string) {
  return isSupabase() ? supabase.findDocumentByHash(hash, workspaceId) : Promise.resolve(local.findDocumentByHash(hash, workspaceId));
}

export async function deleteDocument(id: string) {
  return isSupabase() ? supabase.deleteDocument(id) : Promise.resolve(local.deleteDocument(id));
}

/* ------------------------- Document versions ------------------------- */

export async function insertDocumentVersion(v: NewDocumentVersionInput) {
  return isSupabase() ? supabase.insertDocumentVersion(v) : Promise.resolve(local.insertDocumentVersion(v));
}

export async function getDocumentVersion(id: string) {
  return isSupabase() ? supabase.getDocumentVersion(id) : Promise.resolve(local.getDocumentVersion(id));
}

export async function listDocumentVersions(documentId: string) {
  return isSupabase() ? supabase.listDocumentVersions(documentId) : Promise.resolve(local.listDocumentVersions(documentId));
}

/* ------------------------- Query logs ------------------------- */

export async function insertQueryLog(ql: NewQueryLogInput) {
  return isSupabase() ? supabase.insertQueryLog(ql) : Promise.resolve(local.insertQueryLog(ql));
}

export async function getQueryLog(id: string) {
  return isSupabase() ? supabase.getQueryLog(id) : Promise.resolve(local.getQueryLog(id));
}

export async function setFeedbackStatus(id: string, status: FeedbackStatus) {
  return isSupabase() ? supabase.setFeedbackStatus(id, status) : Promise.resolve(local.setFeedbackStatus(id, status));
}

export async function listFlaggedLogsSince(workspaceId: string, sinceIso: string) {
  return isSupabase()
    ? supabase.listFlaggedLogsSince(workspaceId, sinceIso)
    : Promise.resolve(local.listFlaggedLogsSince(workspaceId, sinceIso));
}

export async function hasActiveCorrectionForQuestions(workspaceId: string) {
  return isSupabase()
    ? supabase.hasActiveCorrectionForQuestions(workspaceId)
    : Promise.resolve(local.hasActiveCorrectionForQuestions(workspaceId));
}

export async function countRetryChain(queryLogId: string) {
  return isSupabase() ? supabase.countRetryChain(queryLogId) : Promise.resolve(local.countRetryChain(queryLogId));
}

export async function findCachedAnswer(workspaceId: string, normalizedQuestion: string, documentIds: string[]) {
  return isSupabase()
    ? supabase.findCachedAnswer(workspaceId, normalizedQuestion, documentIds)
    : Promise.resolve(local.findCachedAnswer(workspaceId, normalizedQuestion, documentIds));
}

/* ------------------------- Corrections ------------------------- */

export async function insertCorrection(input: NewCorrectionInput) {
  return isSupabase() ? supabase.insertCorrection(input) : Promise.resolve(local.insertCorrection(input));
}

export async function updateCorrectionText(
  id: string,
  fields: { question_text?: string; corrected_answer_text?: string; note?: string | null; topic_tags?: string[] }
) {
  return isSupabase() ? supabase.updateCorrectionText(id, fields) : Promise.resolve(local.updateCorrectionText(id, fields));
}

export async function setCorrectionStatus(
  id: string,
  status: CorrectionStatus,
  supersedesBy?: string,
  extra?: { approved_by?: string | null; rejection_reason?: string | null }
) {
  return isSupabase()
    ? supabase.setCorrectionStatus(id, status, supersedesBy, extra)
    : Promise.resolve(local.setCorrectionStatus(id, status, supersedesBy, extra));
}

export async function setNeedsVersionReview(id: string, flag: boolean) {
  return isSupabase() ? supabase.setNeedsVersionReview(id, flag) : Promise.resolve(local.setNeedsVersionReview(id, flag));
}

export async function incrementCorrectionStats(id: string, field: "served_count" | "confirmed_count") {
  return isSupabase()
    ? supabase.incrementCorrectionStats(id, field)
    : Promise.resolve(local.incrementCorrectionStats(id, field));
}

export async function updateCorrectionScope(id: string, scope: CorrectionScope, documentId: string | null) {
  return isSupabase()
    ? supabase.updateCorrectionScope(id, scope, documentId)
    : Promise.resolve(local.updateCorrectionScope(id, scope, documentId));
}

export async function getCorrection(id: string) {
  return isSupabase() ? supabase.getCorrection(id) : Promise.resolve(local.getCorrection(id));
}

export async function listCorrections(workspaceId: string, documentId?: string, includeNonLive = true) {
  return isSupabase()
    ? supabase.listCorrections(workspaceId, documentId, includeNonLive)
    : Promise.resolve(local.listCorrections(workspaceId, documentId, includeNonLive));
}

export async function listPendingCorrections(workspaceId: string) {
  return isSupabase() ? supabase.listPendingCorrections(workspaceId) : Promise.resolve(local.listPendingCorrections(workspaceId));
}

export async function listCorrectionsWithPendingEdits(workspaceId: string) {
  return isSupabase()
    ? supabase.listCorrectionsWithPendingEdits(workspaceId)
    : Promise.resolve(local.listCorrectionsWithPendingEdits(workspaceId));
}

export async function setPendingEdit(id: string, payload: PendingEditPayload | null, editorId: string | null) {
  return isSupabase()
    ? supabase.setPendingEdit(id, payload, editorId)
    : Promise.resolve(local.setPendingEdit(id, payload, editorId));
}

export async function listActiveCorrectionsForDocs(workspaceId: string, documentIds: string[]) {
  return isSupabase()
    ? supabase.listActiveCorrectionsForDocs(workspaceId, documentIds)
    : Promise.resolve(local.listActiveCorrectionsForDocs(workspaceId, documentIds));
}

export async function deleteCorrectionsForDocument(documentId: string) {
  return isSupabase()
    ? supabase.deleteCorrectionsForDocument(documentId)
    : Promise.resolve(local.deleteCorrectionsForDocument(documentId));
}

export async function listCorrectionsNeedingVersionReview(workspaceId: string) {
  return isSupabase()
    ? supabase.listCorrectionsNeedingVersionReview(workspaceId)
    : Promise.resolve(local.listCorrectionsNeedingVersionReview(workspaceId));
}

/* ------------------------- Comments ------------------------- */

export async function insertComment(correctionId: string, authorId: string, body: string) {
  return isSupabase()
    ? supabase.insertComment(correctionId, authorId, body)
    : Promise.resolve(local.insertComment(correctionId, authorId, body));
}

export async function getComment(id: string) {
  return isSupabase() ? supabase.getComment(id) : Promise.resolve(local.getComment(id));
}

export async function listComments(correctionId: string) {
  return isSupabase() ? supabase.listComments(correctionId) : Promise.resolve(local.listComments(correctionId));
}

export async function deleteCommentsForCorrections(correctionIds: string[]) {
  return isSupabase()
    ? supabase.deleteCommentsForCorrections(correctionIds)
    : Promise.resolve(local.deleteCommentsForCorrections(correctionIds));
}

/* ------------------------- Audit log ------------------------- */

export async function appendAudit(entry: NewAuditEntry) {
  return isSupabase() ? supabase.appendAudit(entry) : Promise.resolve(local.appendAudit(entry));
}

export async function getAuditEntry(id: string) {
  return isSupabase() ? supabase.getAuditEntry(id) : Promise.resolve(local.getAuditEntry(id));
}

export async function listAuditEntries(workspaceId: string, limit?: number, offset?: number) {
  return isSupabase()
    ? supabase.listAuditEntries(workspaceId, limit, offset)
    : Promise.resolve(local.listAuditEntries(workspaceId, limit, offset));
}

/* ------------------------- Conflict alerts ------------------------- */

export async function insertConflictAlert(a: NewConflictAlert) {
  return isSupabase() ? supabase.insertConflictAlert(a) : Promise.resolve(local.insertConflictAlert(a));
}

export async function getConflictAlert(id: string) {
  return isSupabase() ? supabase.getConflictAlert(id) : Promise.resolve(local.getConflictAlert(id));
}

export async function listConflictAlerts(workspaceId: string, status?: "open" | "resolved" | "dismissed") {
  return isSupabase()
    ? supabase.listConflictAlerts(workspaceId, status)
    : Promise.resolve(local.listConflictAlerts(workspaceId, status));
}

export async function findExistingConflict(workspaceId: string, refA: string, refB: string) {
  return isSupabase()
    ? supabase.findExistingConflict(workspaceId, refA, refB)
    : Promise.resolve(local.findExistingConflict(workspaceId, refA, refB));
}

export async function setConflictStatus(id: string, status: "open" | "resolved" | "dismissed") {
  return isSupabase() ? supabase.setConflictStatus(id, status) : Promise.resolve(local.setConflictStatus(id, status));
}

/* ------------------------- Integrations ------------------------- */

export async function upsertIntegrationConnection(c: UpsertConnectionInput) {
  return isSupabase()
    ? supabase.upsertIntegrationConnection(c)
    : Promise.resolve(local.upsertIntegrationConnection(c));
}

export async function getIntegrationConnection(workspaceId: string, provider: string) {
  return isSupabase()
    ? supabase.getIntegrationConnection(workspaceId, provider)
    : Promise.resolve(local.getIntegrationConnection(workspaceId, provider));
}

export async function listIntegrationConnections(workspaceId: string) {
  return isSupabase()
    ? supabase.listIntegrationConnections(workspaceId)
    : Promise.resolve(local.listIntegrationConnections(workspaceId));
}

export async function deleteIntegrationConnection(workspaceId: string, provider: string) {
  return isSupabase()
    ? supabase.deleteIntegrationConnection(workspaceId, provider)
    : Promise.resolve(local.deleteIntegrationConnection(workspaceId, provider));
}

/* ------------------------- API keys ------------------------- */

export async function insertApiKey(k: NewApiKeyInput) {
  return isSupabase() ? supabase.insertApiKey(k) : Promise.resolve(local.insertApiKey(k));
}

export async function getApiKey(id: string) {
  return isSupabase() ? supabase.getApiKey(id) : Promise.resolve(local.getApiKey(id));
}

export async function findApiKeyByHash(keyHash: string) {
  return isSupabase() ? supabase.findApiKeyByHash(keyHash) : Promise.resolve(local.findApiKeyByHash(keyHash));
}

export async function listApiKeys(workspaceId: string) {
  return isSupabase() ? supabase.listApiKeys(workspaceId) : Promise.resolve(local.listApiKeys(workspaceId));
}

export async function revokeApiKey(id: string) {
  return isSupabase() ? supabase.revokeApiKey(id) : Promise.resolve(local.revokeApiKey(id));
}

/* ------------------------- Suggested corrections ------------------------- */

export async function insertSuggestedCorrection(s: NewSuggestedCorrection) {
  return isSupabase() ? supabase.insertSuggestedCorrection(s) : Promise.resolve(local.insertSuggestedCorrection(s));
}

export async function getSuggestedCorrection(id: string) {
  return isSupabase() ? supabase.getSuggestedCorrection(id) : Promise.resolve(local.getSuggestedCorrection(id));
}

export async function listSuggestedCorrections(workspaceId: string, status?: "pending" | "accepted" | "dismissed") {
  return isSupabase()
    ? supabase.listSuggestedCorrections(workspaceId, status)
    : Promise.resolve(local.listSuggestedCorrections(workspaceId, status));
}

export async function setSuggestedCorrectionStatus(id: string, status: "pending" | "accepted" | "dismissed") {
  return isSupabase()
    ? supabase.setSuggestedCorrectionStatus(id, status)
    : Promise.resolve(local.setSuggestedCorrectionStatus(id, status));
}

export async function findSimilarPendingSuggestion(workspaceId: string, canonicalQuestion: string) {
  return isSupabase()
    ? supabase.findSimilarPendingSuggestion(workspaceId, canonicalQuestion)
    : Promise.resolve(local.findSimilarPendingSuggestion(workspaceId, canonicalQuestion));
}

/* ------------------------- Webhooks ------------------------- */

export async function insertWebhookEndpoint(w: NewWebhookEndpoint) {
  return isSupabase() ? supabase.insertWebhookEndpoint(w) : Promise.resolve(local.insertWebhookEndpoint(w));
}

export async function getWebhookEndpoint(id: string) {
  return isSupabase() ? supabase.getWebhookEndpoint(id) : Promise.resolve(local.getWebhookEndpoint(id));
}

export async function listWebhookEndpoints(workspaceId: string) {
  return isSupabase() ? supabase.listWebhookEndpoints(workspaceId) : Promise.resolve(local.listWebhookEndpoints(workspaceId));
}

export async function deleteWebhookEndpoint(id: string) {
  return isSupabase() ? supabase.deleteWebhookEndpoint(id) : Promise.resolve(local.deleteWebhookEndpoint(id));
}

/* ------------------------- Chat sessions & messages ------------------------- */

export async function insertChatSession(input: NewChatSessionInput) {
  return isSupabase() ? supabase.insertChatSession(input) : Promise.resolve(local.insertChatSession(input));
}

export async function getChatSession(id: string) {
  return isSupabase() ? supabase.getChatSession(id) : Promise.resolve(local.getChatSession(id));
}

export async function listChatSessions(userId: string, workspaceId: string) {
  return isSupabase() ? supabase.listChatSessions(userId, workspaceId) : Promise.resolve(local.listChatSessions(userId, workspaceId));
}

export async function touchChatSession(id: string, documentIds: string[]) {
  return isSupabase() ? supabase.touchChatSession(id, documentIds) : Promise.resolve(local.touchChatSession(id, documentIds));
}

export async function renameChatSession(id: string, title: string) {
  return isSupabase() ? supabase.renameChatSession(id, title) : Promise.resolve(local.renameChatSession(id, title));
}

export async function insertChatMessage(input: NewChatMessageInput) {
  return isSupabase() ? supabase.insertChatMessage(input) : Promise.resolve(local.insertChatMessage(input));
}

export async function getChatMessage(id: string) {
  return isSupabase() ? supabase.getChatMessage(id) : Promise.resolve(local.getChatMessage(id));
}

export async function listChatMessages(sessionId: string) {
  return isSupabase() ? supabase.listChatMessages(sessionId) : Promise.resolve(local.listChatMessages(sessionId));
}

export async function archiveChatSession(id: string) {
  return isSupabase() ? supabase.archiveChatSession(id) : Promise.resolve(local.archiveChatSession(id));
}

export async function deleteChatSession(id: string) {
  return isSupabase() ? supabase.deleteChatSession(id) : Promise.resolve(local.deleteChatSession(id));
}

export async function deleteChatSessionsForWorkspace(workspaceId: string) {
  return isSupabase()
    ? supabase.deleteChatSessionsForWorkspace(workspaceId)
    : Promise.resolve(local.deleteChatSessionsForWorkspace(workspaceId));
}

/* Re-export row types so callers that need them can import from one place. */
export type {
  UserRow,
  WorkspaceRow,
  WorkspaceMembershipRow,
  DocumentRow,
  DocumentVersionRow,
  QueryLogRow,
  CorrectionRow,
  CorrectionCommentRow,
  AuditLogEntryRow,
  ConflictAlertRow,
  IntegrationConnectionRow,
  ApiKeyRow,
  SuggestedCorrectionRow,
  WebhookEndpointRow,
  ChatSessionRow,
  ChatMessageRow,
} from "./types";

import type {
  CorrectionScope,
  CorrectionStatus,
  DocumentRow,
  FeedbackStatus,
  WorkspaceRow,
} from "./types";
