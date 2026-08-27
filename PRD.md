# PRD: Crispr — Self-Correcting Document Q&A

*"Crispr" (v1 working name: "Verity"). This document combines PRD v1 (core product) and PRD v2 (collaboration, trust, integrations & compounding intelligence) into a single specification.*

| | |
|---|---|
| **Status** | Combined PRD (v1 Draft + v2) |
| **Owner** | Product / Eng (TBD) |
| **Last updated** | August 26, 2026 |

---

## 1. Executive Summary

Crispr is a web application that lets a user upload documents and ask natural-language questions about them, getting answers grounded in the source material with page-level citations. What differentiates it from standard document-RAG tools is a built-in correction loop: when an answer is wrong — whether because retrieval grabbed the wrong chunk, the model misread it, or the source document itself is outdated or incorrect — the user can flag it, the system will attempt to self-correct via a different retrieval strategy, and if that's not enough, the user can supply the right answer directly. That correction is persisted in a dedicated override layer that is checked ahead of standard retrieval on every future query, so the same mistake is never served twice, without ever having to edit or re-upload the source document. The product's core bet is that correctness in document Q&A shouldn't be static and shouldn't be capped by what the original file happens to say — it should improve every time a human corrects it.

The v1 release proved that thesis for a single user. The v2 release turns it into a business by layering five new capability pillars on top of the correction engine:

- **Pillar A — Collaboration:** shared workspaces, roles, and approval workflows so a team's knowledge base benefits from every member's corrections.
- **Pillar B — Depth of document handling:** multi-document synthesis, table/chart extraction, version diffing, and non-PDF formats.
- **Pillar C — Trust & compliance:** immutable audit logs, confidence scoring, proactive conflict detection, and on-prem deployment.
- **Pillar D — Integrations:** Slack/Teams bots, a public API, Zapier/Make connectors, live document-source sync, and a browser extension.
- **Pillar E — Compounding intelligence:** cross-document suggestions and repeated-flag analysis that make accuracy compound across documents and users instead of resetting with each upload.

Each pillar maps directly to unlocking a pricing tier — Free, Pro, Team, Enterprise — serving three buyers: the individual professional who outgrows Free's caps (Pro), the team lead who needs review and accountability before a correction goes live (Team), and the enterprise buyer who needs SSO, on-prem deployment, and an SLA before regulated or confidential documents can be touched (Enterprise).

## 2. Problem Statement

Standard PDF/document-RAG systems fail in three distinct ways, and none of them are fixable without editing the source file:

1. **Retrieval error** — the correct information exists in the document, but the wrong chunk gets retrieved for a given phrasing of the question.
2. **Generation error** — the correct chunk is retrieved, but the model misstates, oversimplifies, or hallucinates around it.
3. **Source error** — the document itself is outdated, was superseded by an amendment, or simply contains a mistake.

In all three cases, the same wrong answer recurs indefinitely, because nothing about asking the same question again changes the outcome. Fixing a source error today means editing the file and re-uploading it — something most users can't or won't do (they don't own the source document, or it isn't editable, or the "correct" answer isn't written down anywhere yet, just known to the user).

## 3. Goals & Success Metrics

### Product goals (v1)

- **G1 — No repeat mistakes.** Once a correction is confirmed, ~100% of subsequent identical or paraphrased queries should return the corrected answer, not the original wrong one.
- **G2 — Fast answers.** Median end-to-end latency under 4–6s for fresh retrieval + generation; under 1–2s when an answer is served from the correction layer.
- **G3 — Grounded answers.** ≥90% of generated claims should be traceable to a specific cited page/section.
- **G4 — Declining correction rate.** Corrections submitted per 100 queries on a given document should trend down over time as the correction layer absorbs known issues.
- **G5 — Zero hardcoding.** All of the above must work for any document a user uploads, with no document-specific setup.

### Business goals (v2)

| Goal | Metric | Target (12 months post-launch) |
| --- | --- | --- |
| Convert Free to paid | Free → Pro conversion rate | ≥ 8% |
| Land team accounts | Pro → Team upgrade rate | ≥ 15% of Pro accounts with 2+ collaborators |
| Land enterprise accounts | Team → Enterprise upgrade rate | ≥ 5 enterprise logos in first 2 quarters post-Phase 3 |
| Expansion revenue | Net revenue retention | ≥ 115% |
| Reduce churn | Monthly logo churn (Team/Enterprise) | ≤ 2% |

### Product goals (v2)

| Goal | Metric | Target |
| --- | --- | --- |
| Fast time-to-value on corrections | Time from workspace creation to first approved correction | < 24 hours median |
| Multi-document usage is real, not vestigial | % of Team/Enterprise queries spanning 2+ documents | ≥ 30% |
| Confidence scoring is trusted | % of "needs review" flagged answers a human confirms were actually wrong | ≥ 60% |
| Integrations drive engagement | % of Team/Enterprise queries originating from Slack/Teams/API vs. web app | ≥ 25% within 6 months of Phase 2 launch |
| Compounding intelligence reduces repeat work | % reduction in duplicate corrections for semantically similar questions, QoQ | ≥ 20% reduction by Q2 post-Phase 3 |

### KPIs (measured continuously)

- Repeat-wrong-answer rate (target: ~0% for already-corrected questions).
- Correction rate per 100 queries, tracked over time per workspace (should trend down).
- Groundedness/citation accuracy on sampled evals.
- Retry success rate — % of automatic retries the user confirms as correct without needing a manual correction.
- Answer thumbs-up rate / user-reported satisfaction.
- Median time from flag to a persisted correction.
- Retrieval precision/recall against a held-out Q&A eval set.
- Weekly active documents and querying users per workspace.

## 4. Target Users & Personas

### Base personas (v1)

- **Individual researcher / student** — uploads papers or textbook chapters, asks specific questions, corrects stale citations or superseded findings.
- **Compliance / policy analyst** — uploads regulations or internal policy PDFs; needs answers to reflect amendments that haven't made it into a reissued document yet.
- **Support / operations agent** — uploads product manuals or SOPs; flags steps that are out of date and supplies the current procedure without waiting on a doc revision cycle.
- **Small team knowledge-base owner** — uploads onboarding docs or handbooks; wants one teammate's correction to be visible to everyone else, not just themselves.

### Tiered personas (v2)

**Priya, Individual Power User (Pro).** A freelance financial analyst referencing 40+ client PDFs — prospectuses, filings, past reports. On Free she hits the 3-document cap immediately. She upgrades to Pro for unlimited documents and persistent corrections. Scenario: she uploads a new 10-K, asks Crispr to summarize a risk section, gets an answer that misstates a subsidiary's ownership percentage, flags it, and supplies the correct number. The next time she or any future query touches that section, the corrected number is returned — without her needing to remember she ever fixed it.

**Marcus, Team Lead on a Support/Compliance Team (Team).** Marcus runs a 12-person support team answering customer questions against a shared library of policy PDFs. Historically, if one agent corrected an answer, no one else benefited, and no one could tell who approved what. He upgrades to Team for a shared workspace and approval workflows. Scenario: an agent flags an outdated refund policy and submits a correction. Because policy corrections require review, it enters a pending queue; Marcus reviews it against the actual policy doc, approves it, and it instantly propagates to all 12 agents. The audit log records who submitted, who approved, and when.

**Dana, Enterprise Buyer/Admin (Enterprise).** Director of Knowledge Ops at a mid-size insurance company. Legal requires customer policy documents never leave company infrastructure; IT requires SSO and centralized access control before approving new SaaS tools. She needs an on-prem deployment, SSO integration, and a signed SLA before rollout past a pilot team. Scenario: Dana's team runs Crispr in a private VPC, provisions access via the company's SSO provider, and uses the public API to embed Q&A directly into the internal claims-processing tool, so adjusters never leave their existing workflow.

### Example scenarios (v1)

- A compliance analyst uploads a 120-page regulation, asks for the maximum penalty for late filing, and gets an answer citing a figure from an old page. They know it was revised. They flag it, enter the updated figure with a note ("per 2025 amendment"), and from then on anyone asking that question gets the amended figure — clearly labeled as a correction, not as original document text.
- A student asks a question and gets an answer built from a chunk that's technically relevant but taken slightly out of context. They flag it; the system retries with a different retrieval strategy and surfaces the right passage on the second attempt, with no manual correction needed.

## 5. Core User Flows

**(a) Upload & Ingestion**
1. User drags in one or more documents.
2. System validates file type, size, and page count.
3. System extracts text, falling back to OCR for scanned/image-based pages.
4. System chunks the text, generates embeddings, and writes them to a vector index scoped to that document and workspace.
5. System marks the document "ready" and shows metadata (page count, language, any OCR warnings).

**(b) Ask a Question**
1. User types a question in the chat interface, scoped to one or more of their uploaded documents.
2. System embeds the question and checks the correction/override index first.
3. If nothing matches, system runs retrieval (vector + hybrid) over document chunks, re-ranks, and generates an answer constrained to cite only retrieved content.
4. Answer renders with inline citations and a groundedness indicator.

**(c) Flag an Answer as Wrong**
1. User taps "This is wrong" on a specific answer.
2. A lightweight panel opens: optional free-text on what's wrong, plus two actions — "Try again" or "I know the correct answer."

**(d) System Retries**
1. On "Try again," the system re-runs retrieval with an adjusted strategy (wider top-k, hybrid/keyword search, different re-ranking, or a stricter grounding prompt) rather than repeating the same call.
2. The new answer is shown for confirmation.
3. After 2 failed attempts (configurable), the system stops retrying automatically and prompts the user to supply the answer directly.

**(e) User Submits a Correction**
1. User types the correct answer, optionally with a source or reason.
2. System asks whether the correction applies to just this exact question or to the underlying topic more broadly (so future rephrasings match it too).
3. System stores a structured correction record linking the original question, its embedding, the wrong answer, the corrected answer, the document, the submitting user, and a timestamp.

**(f) Correction Served on Future Queries**
1. On every new query, the system checks the correction index for a semantically similar prior question before finalizing an answer.
2. Above a similarity threshold, the corrected answer is returned directly, labeled "Corrected by [user] on [date]," with an option to view the original AI-generated answer and underlying document text.
3. Near the threshold, the system can show the correction as the primary answer with retrieved document content as secondary context, rather than picking silently.

**(g) Managing Past Corrections**
1. A "Corrections" view, scoped per-document or workspace-wide, lists every correction: original question, wrong answer, corrected answer, who/when, and status.
2. Users can edit, retire (revert to document-derived answers), or merge duplicate corrections.

## 6. Functional Requirements

Requirements are numbered contiguously: FR-1…FR-31 cover the core correction engine (v1); FR-32…FR-52 cover the five v2 pillars. Tier gates are noted per requirement where applicable.

### 6.1 Upload & Ingestion

- **FR-1**: The system shall allow users to upload one or more PDF files via drag-and-drop or file picker.
- **FR-2**: The system shall support PDFs up to 200MB or ~1,000 pages per file (configurable).
- **FR-3**: The system shall extract text from both digitally-native and scanned/image-based PDFs, automatically applying OCR when native extraction yields insufficient text.
- **FR-4**: The system shall detect and clearly report ingestion failures (corrupt file, password-protected, unsupported format) with remediation guidance.
- **FR-5**: The system shall preserve page-level and, where detectable, section-level metadata on every extracted chunk to support citation.

### 6.2 Chunking & Embedding

- **FR-6**: The system shall chunk extracted text using a configurable strategy (e.g., token-based splitting with overlap), tunable per document type.
- **FR-7**: The system shall generate vector embeddings per chunk and store them in a vector index scoped to the source document and owning workspace.
- **FR-8**: The system shall support re-chunking/re-embedding a document if ingestion parameters change or OCR is re-run with improved settings.

### 6.3 Retrieval

- **FR-9**: The system shall perform semantic (vector) retrieval over document chunks for every query.
- **FR-10**: The system shall support hybrid retrieval (vector + keyword/BM25) to improve recall on exact terms, numbers, and named entities.
- **FR-11**: The system shall re-rank retrieved chunks before passing them to generation.
- **FR-12**: The system shall check the corrections index for a matching prior-corrected question before finalizing an answer, per the precedence rule in FR-22.

### 6.4 Answer Generation

- **FR-13**: The system shall generate answers strictly grounded in retrieved chunks (or an applicable correction), and shall not assert facts absent from both.
- **FR-14**: The system shall attach citations (document name, page, and/or section) to every generated answer.
- **FR-15**: The system shall clearly state when a question can't be answered from the uploaded document(s), rather than fabricating an answer.

### 6.5 Feedback Capture

- **FR-16**: The system shall let a user mark any answer as incorrect via a single visible control.
- **FR-17**: On marking an answer incorrect, the system shall offer two paths: automatic retry, or direct user-supplied correction.

### 6.6 Correction Workflow

- **FR-18**: On retry, the system shall alter its retrieval/generation strategy rather than repeating an identical call.
- **FR-19**: The system shall cap automatic retries at 2 attempts (configurable) before prompting the user for a direct correction.
- **FR-20**: The system shall let a user submit a correct answer as free text, optionally with a note or source.

### 6.7 Correction Persistence & Override Layer

- **FR-21**: The system shall persist every confirmed correction as a structured record, separate from the document index, including: original question, question embedding, flagged answer, corrected answer, associated document(s), submitting user, timestamp, and status.
- **FR-22**: At query time, the system shall check the corrections index for a semantic match (e.g., cosine similarity ≥ 0.87, tunable) before finalizing an answer, and on a match, shall serve the corrected answer instead of a freshly retrieved/generated one.
- **FR-23**: The system shall visually distinguish corrected answers from document-derived answers, and shall never present a correction as if it were verbatim document text.
- **FR-24**: The system shall let users retrieve the original document-derived answer alongside any active correction, for transparency.
- **FR-25**: Corrections shall persist independently of the source document — no modification of the uploaded file is required or performed.

### 6.8 Versioning / Audit Trail

- **FR-26**: The system shall retain a full history of corrections per question/topic, including superseded ones, not just the latest value.
- **FR-27**: The system shall record who made each correction and when, visible in any multi-user workspace.

### 6.9 Conflict Handling

- **FR-28**: When a new correction conflicts with an existing active one for a similar question, the system shall surface the conflict rather than silently overwriting it.
- **FR-29**: The system shall support an explicit resolution action for conflicts: keep existing, replace, or annotate both. Resolution order when near-duplicates exist is **first-approved-wins**: a new approval is blocked until an Approver explicitly chooses to supersede the existing active correction.

### 6.10 Multi-Document & Multi-User Scoping

- **FR-30**: The system shall default corrections to the document and context they were created in, with an explicit option to broaden scope (e.g., "apply workspace-wide" for cross-cutting facts).
- **FR-31**: The system shall support private per-user workspaces as well as shared team workspaces where corrections are visible to all members.

### 6.11 Pillar A — Collaboration & Team Features

- **FR-32**: Users can create a Workspace that contains a shared document library and a shared correction layer. All corrections submitted within a workspace are visible to and used by all workspace members immediately upon approval (or immediately upon submission, if the workspace has approval workflows disabled). *Minimum tier: Team.* Extends the v1 per-document correction override layer from user-scoped to workspace-scoped.
- **FR-33**: Workspace admins can enable "Approval Required" mode per workspace or per document. When enabled, a submitted correction enters a Pending state and does not affect retrieval until a user with Approver or Admin role approves it. Rejected corrections are retained with a rejection reason but never enter the active override layer. Trusted reviewers (Admin/Approver) may have their own submissions go live immediately per role-based gate configuration. *Minimum tier: Team.*
- **FR-34**: Workspaces support four roles — Admin, Approver, Contributor, Viewer — with permissions enforced at the API layer: Admin (manage workspace, users, roles, integrations), Approver (approve/reject corrections, all Contributor permissions), Contributor (upload documents, submit corrections, comment), Viewer (query documents, view corrections, cannot submit). *Minimum tier: Team.*
- **FR-35**: Each correction supports a threaded comment discussion, visible to all workspace members with at least Viewer access to that document. Comments are timestamped and attributed. *Minimum tier: Team.*
- **FR-36**: Workspace admins can view a pending-approvals queue showing all corrections awaiting review, sortable by document, submitter, and age. *Minimum tier: Team.*

### 6.12 Pillar B — Depth of Document Handling

- **FR-37**: A single query can retrieve relevant passages across all documents in a workspace (or a user-selected subset) and return one synthesized answer with per-claim source citations identifying which document each claim came from. *Minimum tier: Pro (single-user multi-doc); Team/Enterprise (workspace-wide multi-doc).*
- **FR-38**: Ingestion pipeline extracts structured content from tables and charts (not just surrounding prose), preserving row/column relationships so a query like "what was Q3 revenue in the table on page 12" returns the correct cell value rather than a paraphrase of nearby text. *Minimum tier: Pro.*
- **FR-39**: When a user uploads a new version of a previously-ingested document, the system detects the prior version, generates a diff summary of material changes (added/removed/modified sections), and prompts the user to review whether any existing corrections on the old version still apply, are now resolved by the source update, or need to be re-flagged. *Minimum tier: Pro.*
- **FR-40**: Ingestion supports Word (.docx), Excel (.xlsx), scanned/OCR'd contracts, and email thread exports (.eml/.msg) as first-class document types, with the same correction-override mechanics as PDF. *Minimum tier: Pro.*

### 6.13 Pillar C — Trust & Compliance

- **FR-41**: All correction and approval activity (submit, approve, reject, edit, delete) is written to an immutable, append-only audit log, exportable as CSV or JSON, including actor, timestamp, before/after state, and workspace context. *Minimum tier: Team.*
- **FR-42**: Every generated answer includes a confidence score derived from retrieval relevance and source agreement. Answers below a configurable threshold are visually flagged "Needs Review" in the UI and excluded from being treated as authoritative in downstream integrations (e.g., Slack bot responses include a visible caveat). *Minimum tier: Pro (score visible); Team (threshold configurable per workspace).*
- **FR-43**: The system periodically scans documents within a workspace for passages that make conflicting factual claims on the same topic (e.g., two policy PDFs stating different refund windows) and surfaces these as proactive Conflict alerts in an admin dashboard, independent of any user having queried that content. *Minimum tier: Team.*
- **FR-44**: Crispr supports deployment into a customer's private cloud VPC or on-premise infrastructure, with all document storage, embeddings, and correction data remaining within the customer's environment. *Minimum tier: Enterprise.*

### 6.14 Pillar D — Integrations

- **FR-45**: A Slack and Microsoft Teams bot allows users to query workspace documents and receive answers (with citations and confidence flags) directly in a channel or DM, without opening the web app. *Minimum tier: Team.*
- **FR-46**: A public REST API exposes document upload, query, and correction-submission endpoints under the requesting account's API key, enabling third-party products to embed Crispr's Q&A engine. *Minimum tier: Enterprise.*
- **FR-47**: Zapier and Make connectors expose "new document uploaded," "correction approved," and "conflict detected" as triggers, and "query document" and "submit correction" as actions, for no-code workflow automation. *Minimum tier: Team.*
- **FR-48**: Workspaces can connect Notion, Confluence, Google Drive, and SharePoint as live document sources: documents in a connected folder/space are auto-ingested and kept in sync on edit, rather than requiring manual re-upload. *Minimum tier: Team (Google Drive, Notion); Enterprise (Confluence, SharePoint, given typical enterprise-only licensing on those platforms).*
- **FR-49**: A browser extension detects a PDF open in the current tab and allows the user to query it against Crispr (ingesting it on the fly if not already in their library), without leaving the page. *Minimum tier: Pro.*

### 6.15 Pillar E — Compounding Intelligence

- **FR-50**: When a correction is approved on one document, the system checks other documents in the same workspace for semantically similar passages and surfaces a "this may also need correcting" suggestion to an Approver, rather than waiting for an independent flag on each document. *Minimum tier: Team.*
- **FR-51**: The system tracks flagged-but-not-yet-corrected questions across a workspace and, upon detecting a repeated pattern (same underlying question flagged 3+ times), proactively generates a suggested correction for Approver review rather than waiting for a user to write one from scratch. *Minimum tier: Team.*
- **FR-52**: An analytics dashboard shows, per workspace: most-flagged documents, most-flagged questions/topics, correction approval/rejection rates, and time-to-approval trends, so an admin can identify which source documents are systematically unreliable. *Minimum tier: Team.*

## 7. Non-Functional Requirements

**Latency**
- Single-document query: ~4–6s target for fresh retrieval + generation; p95 ≤ 2.5s.
- Correction-layer lookups (no generation call needed): ~1–2s.
- Multi-document query (FR-37) across up to 50 documents: p95 ≤ 5s; degrades gracefully (with a "narrowing search" indicator) beyond 50 documents rather than timing out.
- Slack/Teams bot response: p95 ≤ 6s end-to-end including platform round-trip.

**Groundedness**
- ≥90–95% of claims traceable to a cited chunk; hallucination rate target <5%, measured via periodic sampled eval.

**Scalability**
- Background/async ingestion for large documents with job-status polling; support for many concurrent users and documents per workspace without degrading query latency.
- Workspaces support up to 500 members and 50,000 documents at Enterprise tier without architectural changes; Team tier soft-capped at 25 members / 2,000 documents.
- Audit log storage scales independently of primary document store to avoid write contention during high-approval-volume periods.

**Availability & Reliability**
- Query-path uptime: 99.5% baseline.
- Pro: 99.5% uptime, best-effort support. Team: 99.9% uptime, next-business-day support SLA. Enterprise: 99.95% uptime, contractual SLA with defined response times and credits for breach.

**Security & Privacy**
- RBAC (FR-34) enforced server-side on every API call, never client-side only.
- All data encrypted at rest (AES-256) and in transit (TLS 1.2+).
- Strict per-user/workspace data isolation; full deletion of a document's derived data (chunks, embeddings, and its scoped corrections) on request.
- On-prem deployments (FR-44) support customer-managed encryption keys; customers' data never transits Crispr-hosted infrastructure post-deployment.
- API keys (FR-46) scoped per-workspace with revocation and rotation support.
- No use of uploaded content to train third-party or foundation models without explicit consent.

**Cost Control**
- Cache identical queries, avoid redundant embedding calls on duplicate uploads, and skip the generation call entirely when a correction can be served directly.

**Observability**
- Track retrieval quality, latency, correction rate, and per-query cost — without logging raw sensitive document content to third-party tooling unnecessarily.

## 8. System Architecture

**Components**

- **Ingestion pipeline** — file intake → text extraction/OCR → chunker → embedding service → vector store writer, run as an async job so large files don't block the UI.
- **Vector store** — chunk embeddings plus metadata (document id, page, chunk id, section).
- **Corrections store** — a separate index for correction records, each with its own embedding of the associated question/topic. This can live in the same vector database under a distinct collection/namespace so query-time lookups hit both stores through one client.
- **Retrieval orchestration layer** — the core query-time logic:
  1. Embed the incoming question.
  2. Search the corrections index for a semantic match above threshold.
  3. If found, serve the correction (optionally pulling document context alongside it for transparency).
  4. If not found, run standard retrieval (vector + hybrid), re-rank, and pass the result to generation.
- **Generation layer** — an LLM call with a system prompt that enforces citation-only, grounded answers.
- **Feedback/correction service** — handles flagging, retry orchestration, and writes to the corrections store.
- **Frontend** — chat-style Q&A UI, document manager, and corrections dashboard.

**Suggested stack and tradeoffs**

| Layer | Suggestion | Tradeoff to weigh |
|---|---|---|
| Embedding model | A strong general-purpose embedding model | Higher-dimensional embeddings improve match quality but raise storage/compute cost |
| Vector DB | Managed vector database (e.g., a hosted service) | Managed = faster to ship, less ops burden; self-hosted = more control, lower marginal cost at scale |
| LLM | Claude (or equivalent), model configurable | Needs reliable instruction-following for "answer only from provided context" and structured citations |
| Backend | Python/FastAPI or Node/TypeScript + async job runner | Python has stronger RAG/ML tooling; Node may simplify a unified JS stack with the frontend |
| Frontend | React | Standard choice; pairs well with a chat-style UI and inline PDF viewer |
| Storage | Object storage for raw files; relational DB for documents/users/corrections/audit log; vector DB for embeddings | Keeps structured metadata queryable without overloading the vector store |

## 9. Data Model

### Core entities (v1)

**User**

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| name, email | string | |
| workspace_ids | uuid[] | |

**Workspace**

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| name | string | |
| member_ids | uuid[] | |

**Document**

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| workspace_id | uuid | |
| owner_id | uuid | |
| filename, storage_path | string | |
| page_count | int | |
| status | enum | processing / ready / failed |

**Chunk**

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| document_id | uuid | FK → Document |
| page_number | int | |
| section_label | string, nullable | |
| text | text | |
| embedding | vector | |
| token_count | int | |

**QueryLog**

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| workspace_id, user_id | uuid | |
| document_ids | uuid[] | supports multi-doc queries |
| question_text, question_embedding | text, vector | |
| answer_text | text | |
| source_type | enum | document / correction |
| cited_chunk_ids | uuid[] | |
| correction_id | uuid, nullable | set if served from a correction |
| feedback_status | enum | none / flagged / confirmed_correct |

**Correction**

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| workspace_id | uuid | |
| document_id | uuid, nullable | null if scope is workspace-wide |
| original_query_log_id | uuid | FK → QueryLog (the flagged one) |
| question_text, question_embedding | text, vector | |
| wrong_answer_text, corrected_answer_text | text | |
| note | text, nullable | source/justification |
| submitted_by | uuid | FK → User |
| status | enum | active / superseded / retired (+ pending / rejected in approval mode) |
| supersedes_correction_id | uuid, nullable | self-referential chain for audit history |
| scope | enum | document / workspace |

**Relationships**: Workspace 1—N Document, 1—N User. Document 1—N Chunk. QueryLog N—M Document (multi-doc queries). Correction N—1 QueryLog, and 1—N Correction via `supersedes_correction_id` for version history.

### v2 additions & extensions

- **Workspace** (extended) — adds `owner_id`, `approval_required` (bool, per-workspace default), `plan_tier`.
- **WorkspaceMembership** — workspace_id, user_id, role (Admin/Approver/Contributor/Viewer), joined_at.
- **Document** (extended) — adds `workspace_id` (nullable, null = personal), `source_type` (upload/gdrive/notion/confluence/sharepoint), `source_connection_id`, `current_version_id`.
- **DocumentVersion** — id, document_id, version_number, uploaded_at, uploaded_by, diff_summary (text, from FR-39).
- **Correction** (extended) — adds `approved_by`, `approved_at`, `rejection_reason`.
- **CorrectionComment** — id, correction_id, author_id, body, created_at.
- **AuditLogEntry** — id, workspace_id, actor_id, action_type, target_type, target_id, before_state, after_state, timestamp. Append-only; no update/delete path exists.
- **ConfidenceScore** — attached to each Answer record: score (0–1), threshold_at_time_of_query, flagged_needs_review (bool).
- **ConflictAlert** — id, workspace_id, document_a_id, passage_a_ref, passage_a_text, document_b_id, passage_b_ref, passage_b_text, detected_at, status (open/resolved/dismissed).
- **IntegrationConnection** — id, workspace_id, provider (slack/teams/gdrive/notion/confluence/sharepoint/zapier), auth_credentials (encrypted), sync_status, last_synced_at.
- **ApiKey** — id, workspace_id, key_hash, key_prefix, scopes, created_by, revoked_at (nullable).
- **SuggestedCorrection** — id, workspace_id, source_pattern (repeated-question cluster or cross-doc match reference), suggested_text, rationale, status (pending/accepted/dismissed), generated_at.

## 10. API Design

### Core endpoints (v1)

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/documents` | Upload a PDF; returns document id + processing status |
| GET | `/documents/{id}/status` | Poll ingestion status |
| POST | `/query` | Ask a question; returns an answer, citations, and source type |
| POST | `/feedback` | Flag a query log entry as wrong |
| POST | `/query/{query_log_id}/retry` | Trigger an automatic retry with an adjusted strategy |
| POST | `/corrections` | Submit a user-supplied correction |
| GET | `/corrections` | List corrections, filterable by document or workspace |
| PATCH | `/corrections/{id}` | Edit, retire, or resolve a conflicting correction |
| DELETE | `/documents/{id}` | Delete a document, cascading to its chunks and document-scoped corrections |

Example — `POST /query`:
```json
// Request
{
  "workspace_id": "ws_123",
  "document_ids": ["doc_456"],
  "question": "What's the maximum late-filing penalty?"
}

// Response
{
  "query_log_id": "ql_789",
  "answer": "The maximum penalty is $2,500 per late filing.",
  "source_type": "correction",
  "citations": [{ "document_id": "doc_456", "page": 47 }],
  "correction": { "submitted_by": "user_1", "date": "2026-06-12" }
}
```

Example — `POST /corrections`:
```json
// Request
{
  "query_log_id": "ql_789",
  "corrected_answer": "The maximum penalty is $2,500 per late filing, per the 2025 amendment.",
  "note": "Original PDF cites a pre-amendment figure of $1,000.",
  "scope": "document"
}
```

### v2 endpoint additions

| Method | Path | Purpose | Auth |
| --- | --- | --- | --- |
| POST | `/v2/workspaces` | Create a workspace | User session or Enterprise API key |
| DELETE | `/v2/workspaces/{id}` | Delete a workspace and all derived data (admin-only; default workspace protected) | Admin role required |
| POST | `/v2/workspaces/{id}/members` | Invite/add a member with a role | Admin role required |
| PATCH | `/v2/workspaces/{id}/members/{userId}` | Change a member's role | Admin role required |
| DELETE | `/v2/workspaces/{id}/members/{userId}` | Remove a member | Admin role required |
| POST | `/v2/documents/{id}/query?workspace_id=` | Multi-document query scoped to a workspace | Session or API key with `query` scope |
| POST | `/v2/corrections` | Submit a correction (enters pending state if approval_required) | Session or API key with `write` scope |
| POST | `/v2/corrections/{id}/approve` | Approve a pending correction | Approver/Admin role required |
| POST | `/v2/corrections/{id}/reject` | Reject a pending correction with reason | Approver/Admin role required |
| GET/PATCH/DELETE | `/v2/corrections/{id}` | Retrieve (with history), edit, or retire a correction | Contributor+ required |
| GET | `/v2/workspaces/{id}/audit-log?format=csv\|json` | Export audit log | Admin role required |
| GET/POST | `/v2/workspaces/{id}/conflicts` | List conflict alerts / run a contradiction scan | Approver/Admin role required |
| GET/POST | `/v2/workspaces/{id}/suggestions` | List compounding-intelligence suggestions / re-run analysis | Approver/Admin role required |
| GET | `/v2/analytics/{workspace_id}` | Retrieve flagging/approval analytics | Approver/Admin role required |
| GET/POST/DELETE | `/v2/workspaces/{id}/webhooks` | Manage webhook endpoints | Admin role required |
| GET/POST/DELETE | `/v2/workspaces/{id}/integrations` | Manage integration connections | Admin role required |

### Webhook events

Delivered to a customer-configured endpoint (used by Zapier/Make and direct integrations):

- `correction.submitted`
- `correction.approved`
- `correction.rejected`
- `conflict.detected`
- `document.version_updated`

All webhook payloads are signed (HMAC-SHA256) using a per-endpoint secret so receivers can verify authenticity (`X-Crisp-Signature` / `X-Crisp-Timestamp` headers).

## 11. Pricing & Packaging

| Feature | Free | Pro | Team | Enterprise |
| --- | :---: | :---: | :---: | :---: |
| Documents | 1–3 | Unlimited | Unlimited | Unlimited |
| Corrections | Capped/non-persistent | Persistent | Persistent, workspace-shared | Persistent, workspace-shared |
| Multi-document query (FR-37) | — | ✅ (personal docs) | ✅ (workspace-wide) | ✅ (workspace-wide) |
| Table/chart extraction (FR-38) | — | ✅ | ✅ | ✅ |
| Version diffing (FR-39) | — | ✅ | ✅ | ✅ |
| Non-PDF formats (FR-40) | — | ✅ | ✅ | ✅ |
| Browser extension (FR-49) | — | ✅ | ✅ | ✅ |
| Shared workspace (FR-32) | — | — | ✅ | ✅ |
| Approval workflows (FR-33) | — | — | ✅ | ✅ |
| RBAC (FR-34) | — | — | ✅ | ✅ |
| Comment threads (FR-35) | — | — | ✅ | ✅ |
| Audit log export (FR-41) | — | — | ✅ | ✅ |
| Confidence threshold config (FR-42) | Score visible only | Score visible only | ✅ configurable | ✅ configurable |
| Proactive conflict detection (FR-43) | — | — | ✅ | ✅ |
| Slack/Teams bot (FR-45) | — | — | ✅ | ✅ |
| Zapier/Make (FR-47) | — | — | ✅ | ✅ |
| Google Drive/Notion sync (FR-48) | — | — | ✅ | ✅ |
| Confluence/SharePoint sync (FR-48) | — | — | — | ✅ |
| Compounding suggestions (FR-50, FR-51) | — | — | ✅ | ✅ |
| Analytics dashboard (FR-52) | — | — | ✅ | ✅ |
| Public API (FR-46) | — | — | — | ✅ |
| On-prem/private cloud (FR-44) | — | — | — | ✅ |
| SSO | — | — | — | ✅ |
| SLA | — | Best-effort | 99.9% | 99.95% + credits |

## 12. UI/UX Requirements

- **Upload screen** — drag-and-drop zone; list of documents with status chips (processing/ready/failed); selector for which document(s) are active in a query.
- **Chat/Q&A screen** — chat-style thread; each answer shows clickable citation chips that jump to the page in an inline PDF viewer; a subtle badge marks whether an answer came from a correction or fresh retrieval; thumbs up/down on every answer.
- **Feedback modal** — triggered by thumbs-down: optional "what's wrong?" text field, plus "Try again" and "I'll provide the correct answer." A retry shows the new answer inline with the same feedback controls, capped at 2 loops before defaulting to the correction path.
- **Correction entry** — text box for the correct answer, optional note/source field, and a scope selector (this question only / this topic broadly / this workspace).
- **Corrections dashboard** — searchable/filterable table of active corrections per document or workspace, showing wrong → corrected pairs, submitter, date, status lifecycle history, and edit/retire/discussion actions.
- **Transparency toggle** — anywhere a corrected answer appears, a "view original document answer" toggle so users can compare and verify the system isn't hiding the source content.
- **Approvals queue (v2)** — pending corrections with side-by-side "was / proposed fix" comparison, discussion threads, approve/reject-with-reason actions, plus tabs for compounding suggestions and conflict alerts.
- **Analytics dashboard (v2)** — most-flagged documents/topics, approval rates, time-to-approval trends.
- **General interaction rules** — dropdown menus/popovers close on outside click and Escape; destructive actions (document deletion, workspace deletion) require explicit confirmation with animated progress feedback.

## 13. Edge Cases & Failure Modes

- **Extraction fails entirely** (e.g., handwritten scans OCR can't parse) → flag as low-confidence extraction rather than failing silently or answering with no basis.
- **Unanswerable question, no correction exists** → state plainly that the answer isn't in the document(s).
- **A correction is itself wrong** → corrections can be flagged and re-corrected through the same feedback flow; in shared workspaces, corrections from non-reviewer roles can optionally require review before going live.
- **A correction contradicts multiple parts of the document** → prompt the user to confirm a broadened scope explicitly (FR-30) rather than silently applying a narrow fix broadly.
- **Very large documents** → ingest asynchronously with progress reporting; allow Q&A on already-processed sections before the whole file finishes. Embedding calls are batched so very large documents cannot exhaust memory during ingestion.
- **Duplicate uploads** → detect via file hash and offer to reuse the existing index, while still allowing separate documents (and separate correction sets) if the user wants that.
- **Paraphrases that should match a correction but don't** — pure embedding similarity can miss legitimate rephrasings; support manual tagging/keywords on corrections to widen recall.
- **Conflicting active corrections on similar questions** → first-approved-wins by default; superseding requires an explicit Approver action with audit trail.
- **Version updates invalidating corrections** → after a new upload of the same document (FR-39), affected corrections are flagged for review ("still applies / re-flag") rather than silently persisting stale fixes.
- **Correction abuse in shared workspaces** — mitigated by provenance display, approval workflows (FR-33), and the audit trail (FR-41); see Risks.

## 14. Phased Roadmap

### Phase 1 — MVP (v1)
- Single-user workspace.
- Upload, ask, cited answers.
- Flag → retry (capped) → manual correction.
- Corrections stored and served on near-duplicate future queries via embedding similarity.
- Simple corrections list (no full dashboard yet).

### Phase 2 (v1)
- Multi-user shared workspaces with correction visibility and audit trail.
- Conflict detection UI.
- Broader-scope corrections (topic-level, cross-document).
- Hybrid search + re-ranking.
- Full corrections dashboard (edit/retire/history).

### Phase 3 (v1)
- Proactive contradiction detection between document content and existing corrections (not just reactive to a flag).
- Confidence scoring surfaced on generated answers before anyone complains.
- Org-wide correction knowledge base spanning workspaces.
- Optional review/approval workflow for corrections in regulated environments.
- Analytics on correction trends — which topics get corrected most, which signals which source documents actually need revision.

### v2 Rollout Plan

**Phase 1 — Team Collaboration & RBAC** (Pillar A, plus FR-37 personal multi-doc for Pro).
Rationale: this unlocks the Team tier, which is the single biggest revenue-per-account jump from Pro, and it's the smallest engineering lift since it's primarily data-model and permissions work on top of the existing correction engine.

**Phase 2 — Trust/Compliance & Integrations** (Pillars C and D).
Rationale: audit logs, confidence scoring, and Slack/Teams integration are what actually get Team accounts to stick and what enterprise buyers ask for first in procurement. On-prem deployment and the public API are held to the end of this phase since they carry the highest engineering and support cost — build them once Team-tier revenue justifies the investment.

**Phase 3 — Compounding Intelligence** (Pillar E, plus remaining Pillar B items: FR-38–40).
Rationale: this pillar depends on having a meaningful volume of real corrections and multi-document workspaces in production to generate useful cross-document suggestions — it's not useful (and can't be well-tuned) until earlier phases have generated real usage data. It's also the most differentiated, hardest-to-copy pillar, so it's the right thing to polish once the mechanical monetization levers are already live.

## 15. Risks & Open Questions

### From v1

1. **Trust and abuse**: if corrections silently override document content, what stops a mistaken or bad-faith correction from becoming the new wrong answer? Mitigation: always show provenance (who/when), keep the original document-derived answer visible via toggle, and use the review step (FR-33) for corrections from non-reviewer roles in shared workspaces.
2. **Scope ambiguity**: should a correction apply to the exact question asked, or the underlying fact (which might be phrased many ways)? Mitigated by explicit scope selection at correction time plus topic/entity tagging alongside embedding similarity.
3. **Legal/compliance exposure**: in regulated contexts, does letting users override official document content create liability if someone relies on an incorrect correction? Likely needs audit trails (FR-41) and clear in-UI disclaimers.
4. **Model dependency**: grounding and citation reliability depend on the underlying LLM's instruction-following; needs ongoing eval as models change.
5. **Retention policy**: if a document is deleted, should its corrections go with it, or persist if they were broadened to workspace scope? Needs an explicit, stated policy rather than an implicit default. (Current implementation: document-scoped corrections cascade on document deletion; workspace-scoped corrections persist.)
6. **Caching vs. staleness**: cached answers must invalidate correctly when a correction is later retired or superseded, or users will see fixed answers "un-fix" themselves.

### From v2

7. **Correction conflicts in shared workspaces.** Resolution order when multiple corrections target the same passage. *Decision made:* first-approved-wins — superseding requires an explicit Approver opt-in, recorded in the audit trail.
8. **Confidence-score calibration.** A poorly calibrated threshold will either flood users with false "needs review" flags (eroding trust) or miss genuinely wrong answers (defeating the point). Requires a labeled validation set before FR-42 ships broadly.
9. **On-prem support burden.** Enterprise on-prem deployments (FR-44) historically create outsized support and upgrade-path costs relative to revenue. Needs a clear minimum-deal-size threshold before it's offered, and a decision on fully-isolated vs. hybrid deployment model.
10. **Integration auth surface area.** Each new integration (FR-45, FR-47, FR-48) is a new OAuth flow and a new place credentials can leak or be misconfigured. Needs a dedicated security review per integration before general availability, not a single blanket review.
11. **Free-tier cannibalization of Pro.** If Free's document cap or correction limits are too generous, there's no pressure to upgrade; if too stingy, it fails as a funnel. Tune with actual conversion data post-launch rather than fixing permanently at launch.
12. **Cross-document suggestion accuracy (FR-50).** Suggesting a correction on Document B based on a correction approved on Document A risks false positives if the documents cover superficially similar but substantively different scenarios (e.g., two different jurisdictions' policies). Needs its own confidence threshold before suggestions surface to Approvers.
13. **SharePoint/Confluence sync reliability.** These platforms have historically inconsistent APIs and permission models; scoping them to Enterprise-only (per FR-48) may need revisiting if Team-tier customers push back on the gate.

---

## Appendix: The Core Technical Bet

The hardest technical problem here isn't retrieval or generation — both are well-trodden — it's making the correction-override layer generalize correctly at match time. Too loose a similarity match serves someone else's correction to an unrelated question; too tight a match fails to catch a legitimate rephrasing and silently falls back to the same wrong document-derived answer the correction was meant to fix. The recommended approach is a hybrid: combine embedding similarity against the stored question with entity/topic tags extracted when the correction is created, and treat the first few times a correction is served against a new phrasing as a confirmation loop ("did this answer your question?") rather than a silent guess — letting each correction learn its own paraphrase cluster over time, with the human-reviewable audit trail as the backstop for whenever the automated matching gets it wrong.

v2 is what turns Crispr from a tool one person finds useful into infrastructure a team depends on and a company can safely deploy. v1's correction layer answers "is this answer right?" for one user, one document, one moment. The combined vision answers it at the scale that generates revenue: right for a whole team the instant it's approved, right across every document in a knowledge base rather than one at a time, verifiably right enough to pass an audit, reachable from wherever people actually work instead of only a web app, and — with compounding intelligence — increasingly right without anyone having to ask twice.
