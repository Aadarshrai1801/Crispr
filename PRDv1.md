# PRD: Verity — Self-Correcting RAG PDF Q&A Application

*"Verity" is a placeholder working name — swap it for whatever you land on.*

| | |
|---|---|
| **Status** | Draft v1 |
| **Owner** | Product / Eng (TBD) |
| **Last updated** | August 25, 2026 |

---

## 1. Executive Summary

Verity is a web application that lets a user upload any PDF and ask natural-language questions about it, getting answers grounded in the document with page-level citations. What differentiates it from standard PDF-RAG tools is a built-in correction loop: when an answer is wrong — whether because retrieval grabbed the wrong chunk, the model misread it, or the PDF itself is outdated or incorrect — the user can flag it, the system will attempt to self-correct via a different retrieval strategy, and if that's not enough, the user can supply the right answer directly. That correction is persisted in a dedicated override layer that is checked ahead of standard retrieval on every future query, so the same mistake is never served twice, without ever having to edit or re-upload the source PDF. The product's core bet is that correctness in document Q&A shouldn't be static and shouldn't be capped by what the original file happens to say — it should improve every time a human corrects it.

## 2. Problem Statement & Goals

### The problem

Standard PDF-RAG systems fail in three distinct ways, and today none of them are fixable without editing the source file:

1. **Retrieval error** — the correct information exists in the PDF, but the wrong chunk gets retrieved for a given phrasing of the question.
2. **Generation error** — the correct chunk is retrieved, but the model misstates, oversimplifies, or hallucinates around it.
3. **Source error** — the PDF itself is outdated, was superseded by an amendment, or simply contains a mistake.

In all three cases, the same wrong answer recurs indefinitely, because nothing about asking the same question again changes the outcome. Fixing a source error today means editing the PDF and re-uploading it — something most users can't or won't do (they don't own the source document, or it's not editable, or the "correct" answer isn't written down anywhere yet, just known to the user).

### Goals

- **G1 — No repeat mistakes.** Once a correction is confirmed, ~100% of subsequent identical or paraphrased queries should return the corrected answer, not the original wrong one.
- **G2 — Fast answers.** Median end-to-end latency under 4–6 seconds for a fresh retrieval + generation; under ~1–2 seconds when an answer is served from the correction layer.
- **G3 — Grounded answers.** ≥90% of generated claims should be traceable to a specific cited page/section.
- **G4 — Declining correction rate.** Corrections submitted per 100 queries on a given document should trend down over time as the correction layer absorbs known issues.
- **G5 — Zero hardcoding.** All of the above must work for any PDF a user uploads, with no document-specific setup.

## 3. Target Users & Use Cases

**Personas**

- **Individual researcher / student** — uploads papers or textbook chapters, asks specific questions, corrects stale citations or superseded findings.
- **Compliance / policy analyst** — uploads regulations or internal policy PDFs; needs answers to reflect amendments that haven't made it into a reissued document yet.
- **Support / operations agent** — uploads product manuals or SOPs; flags steps that are out of date and supplies the current procedure without waiting on a doc revision cycle.
- **Small team knowledge-base owner** — uploads onboarding docs or handbooks; wants one teammate's correction to be visible to everyone else, not just themselves.

**Example scenarios**

- A compliance analyst uploads a 120-page regulation, asks for the maximum penalty for late filing, and gets an answer citing a figure from an old page. They know it was revised. They flag it, enter the updated figure with a note ("per 2025 amendment"), and from then on anyone asking that question gets the amended figure — clearly labeled as a correction, not as original document text.
- A student asks a question and gets an answer built from a chunk that's technically relevant but taken slightly out of context. They flag it; the system retries with a different retrieval strategy and surfaces the right passage on the second attempt, with no manual correction needed.

## 4. Core User Flows

**(a) Upload & Ingestion**
1. User drags in one or more PDFs.
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

## 5. Functional Requirements

**Upload & Ingestion**
- **FR-1**: The system shall allow users to upload one or more PDF files via drag-and-drop or file picker.
- **FR-2**: The system shall support PDFs up to 200MB or ~1,000 pages per file (configurable).
- **FR-3**: The system shall extract text from both digitally-native and scanned/image-based PDFs, automatically applying OCR when native extraction yields insufficient text.
- **FR-4**: The system shall detect and clearly report ingestion failures (corrupt file, password-protected, unsupported format) with remediation guidance.
- **FR-5**: The system shall preserve page-level and, where detectable, section-level metadata on every extracted chunk to support citation.

**Chunking & Embedding**
- **FR-6**: The system shall chunk extracted text using a configurable strategy (e.g., token-based splitting with overlap), tunable per document type.
- **FR-7**: The system shall generate vector embeddings per chunk and store them in a vector index scoped to the source document and owning workspace.
- **FR-8**: The system shall support re-chunking/re-embedding a document if ingestion parameters change or OCR is re-run with improved settings.

**Retrieval**
- **FR-9**: The system shall perform semantic (vector) retrieval over document chunks for every query.
- **FR-10**: The system shall support hybrid retrieval (vector + keyword/BM25) to improve recall on exact terms, numbers, and named entities.
- **FR-11**: The system shall re-rank retrieved chunks before passing them to generation.
- **FR-12**: The system shall check the corrections index for a matching prior-corrected question before finalizing an answer, per the precedence rule in FR-22.

**Answer Generation**
- **FR-13**: The system shall generate answers strictly grounded in retrieved chunks (or an applicable correction), and shall not assert facts absent from both.
- **FR-14**: The system shall attach citations (document name, page, and/or section) to every generated answer.
- **FR-15**: The system shall clearly state when a question can't be answered from the uploaded document(s), rather than fabricating an answer.

**Feedback Capture**
- **FR-16**: The system shall let a user mark any answer as incorrect via a single visible control.
- **FR-17**: On marking an answer incorrect, the system shall offer two paths: automatic retry, or direct user-supplied correction.

**Correction Workflow**
- **FR-18**: On retry, the system shall alter its retrieval/generation strategy rather than repeating an identical call.
- **FR-19**: The system shall cap automatic retries at 2 attempts (configurable) before prompting the user for a direct correction.
- **FR-20**: The system shall let a user submit a correct answer as free text, optionally with a note or source.

**Correction Persistence & Override Layer**
- **FR-21**: The system shall persist every confirmed correction as a structured record, separate from the document index, including: original question, question embedding, flagged answer, corrected answer, associated document(s), submitting user, timestamp, and status.
- **FR-22**: At query time, the system shall check the corrections index for a semantic match (e.g., cosine similarity ≥ 0.87, tunable) before finalizing an answer, and on a match, shall serve the corrected answer instead of a freshly retrieved/generated one.
- **FR-23**: The system shall visually distinguish corrected answers from document-derived answers, and shall never present a correction as if it were verbatim PDF text.
- **FR-24**: The system shall let users retrieve the original document-derived answer alongside any active correction, for transparency.
- **FR-25**: Corrections shall persist independently of the source PDF — no modification of the uploaded file is required or performed.

**Versioning / Audit Trail**
- **FR-26**: The system shall retain a full history of corrections per question/topic, including superseded ones, not just the latest value.
- **FR-27**: The system shall record who made each correction and when, visible in any multi-user workspace.

**Conflict Handling**
- **FR-28**: When a new correction conflicts with an existing active one for a similar question, the system shall surface the conflict rather than silently overwriting it.
- **FR-29**: The system shall support an explicit resolution action for conflicts: keep existing, replace, or annotate both.

**Multi-Document & Multi-User Scoping**
- **FR-30**: The system shall default corrections to the document and context they were created in, with an explicit option to broaden scope (e.g., "apply workspace-wide" for cross-cutting facts).
- **FR-31**: The system shall support private per-user workspaces as well as shared team workspaces where corrections are visible to all members.

## 6. Non-Functional Requirements

- **Latency**: ~4–6s target for fresh retrieval + generation; ~1–2s for correction-layer lookups (no generation call needed).
- **Groundedness**: ≥90–95% of claims traceable to a cited chunk; hallucination rate target <5%, measured via periodic sampled eval.
- **Scalability**: background/async ingestion for large documents with job-status polling; support for many concurrent users and documents per workspace without degrading query latency.
- **Availability**: target 99.5% uptime for the query path.
- **Security & privacy**: encryption at rest and in transit, strict per-user/workspace data isolation, full deletion of a document's derived data (chunks, embeddings, and its scoped corrections) on request, no use of uploaded content to train third-party or foundation models without explicit consent.
- **Cost control**: cache identical queries, avoid redundant embedding calls on duplicate uploads, and skip the generation call entirely when a correction can be served directly.
- **Observability**: track retrieval quality, latency, correction rate, and per-query cost — without logging raw sensitive PDF content to third-party tooling unnecessarily.

## 7. System Architecture

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
| LLM | Claude, model configurable | Needs reliable instruction-following for "answer only from provided context" and structured citations |
| Backend | Python/FastAPI or Node/TypeScript + async job runner | Python has stronger RAG/ML tooling; Node may simplify a unified JS stack with the frontend |
| Frontend | React | Standard choice; pairs well with a chat-style UI and inline PDF viewer |
| Storage | Object storage for raw PDFs; relational DB for documents/users/corrections/audit log; vector DB for embeddings | Keeps structured metadata queryable without overloading the vector store |

## 8. Data Model

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
| status | enum | active / superseded / retired |
| supersedes_correction_id | uuid, nullable | self-referential chain for audit history |
| scope | enum | document / workspace |

**Relationships**: Workspace 1—N Document, 1—N User. Document 1—N Chunk. QueryLog N—M Document (multi-doc queries). Correction N—1 QueryLog, and 1—N Correction via `supersedes_correction_id` for version history.

## 9. API Design

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

## 10. UI/UX Requirements

- **Upload screen** — drag-and-drop zone; list of documents with status chips (processing/ready/failed); selector for which document(s) are active in a query.
- **Chat/Q&A screen** — chat-style thread; each answer shows clickable citation chips that jump to the page in an inline PDF viewer; a subtle badge marks whether an answer came from a correction or fresh retrieval; thumbs up/down on every answer.
- **Feedback modal** — triggered by thumbs-down: optional "what's wrong?" text field, plus "Try again" and "I'll provide the correct answer." A retry shows the new answer inline with the same feedback controls, capped at 2 loops before defaulting to the correction path.
- **Correction entry** — text box for the correct answer, optional note/source field, and a scope selector (this question only / this topic broadly / this workspace).
- **Corrections dashboard** — searchable/filterable table of active corrections per document or workspace, showing wrong → corrected pairs, submitter, date, and edit/retire/history actions.
- **Transparency toggle** — anywhere a corrected answer appears, a "view original document answer" toggle so users can compare and verify the system isn't hiding the source content.

## 11. Edge Cases & Failure Modes

- **Extraction fails entirely** (e.g., handwritten scans OCR can't parse) → flag as low-confidence extraction rather than failing silently or answering with no basis.
- **Unanswerable question, no correction exists** → state plainly that the answer isn't in the document(s).
- **A correction is itself wrong** → corrections can be flagged and re-corrected through the same feedback flow; in shared workspaces, non-owner corrections can optionally require review before going live.
- **A correction contradicts multiple parts of the document** → prompt the user to confirm a broadened scope explicitly (FR-30) rather than silently applying a narrow fix broadly.
- **Very large PDFs** → ingest asynchronously with progress reporting; allow Q&A on already-processed sections before the whole file finishes.
- **Duplicate uploads** → detect via file hash and offer to reuse the existing index, while still allowing separate documents (and separate correction sets) if the user wants that.
- **Paraphrases that should match a correction but don't** — pure embedding similarity can miss legitimate rephrasings; support manual tagging/keywords on corrections to widen recall.
- **Correction abuse in shared workspaces** — see Open Questions & Risks.

## 12. Success Metrics / KPIs

- Repeat-wrong-answer rate (target: ~0% for already-corrected questions).
- Correction rate per 100 queries, tracked over time per workspace (should trend down).
- Groundedness/citation accuracy on sampled evals.
- Retry success rate — % of automatic retries the user confirms as correct without needing a manual correction.
- Answer thumbs-up rate / user-reported satisfaction.
- Median time from flag to a persisted correction.
- Retrieval precision/recall against a held-out Q&A eval set.
- Weekly active documents and querying users per workspace.

## 13. Phased Roadmap

**Phase 1 — MVP**
- Single-user workspace.
- Upload, ask, cited answers.
- Flag → retry (capped) → manual correction.
- Corrections stored and served on near-duplicate future queries via embedding similarity.
- Simple corrections list (no full dashboard yet).

**Phase 2**
- Multi-user shared workspaces with correction visibility and audit trail.
- Conflict detection UI.
- Broader-scope corrections (topic-level, cross-document).
- Hybrid search + re-ranking.
- Full corrections dashboard (edit/retire/history).

**Phase 3**
- Proactive contradiction detection between document content and existing corrections (not just reactive to a flag).
- Confidence scoring surfaced on generated answers before anyone complains.
- Org-wide correction knowledge base spanning workspaces.
- Optional review/approval workflow for corrections in regulated environments.
- Analytics on correction trends — which topics get corrected most, which signals which source documents actually need revision.

## 14. Open Questions & Risks

- **Trust and abuse**: if corrections silently override document content, what stops a mistaken or bad-faith correction from becoming the new wrong answer? Mitigation: always show provenance (who/when), keep the original document-derived answer visible via toggle, and consider a review step for non-owner corrections in shared workspaces.
- **Scope ambiguity**: should a correction apply to the exact question asked, or the underlying fact (which might be phrased many ways)? Mitigated by explicit scope selection at correction time plus topic/entity tagging alongside embedding similarity.
- **Legal/compliance exposure**: in regulated contexts, does letting users override official document content create liability if someone relies on an incorrect correction? Likely needs audit trails and clear in-UI disclaimers.
- **Model dependency**: grounding and citation reliability depend on the underlying LLM's instruction-following; needs ongoing eval as models change.
- **Retention policy**: if a document is deleted, should its corrections go with it, or persist if they were broadened to workspace scope? Needs an explicit, stated policy rather than an implicit default.
- **Caching vs. staleness**: cached answers must invalidate correctly when a correction is later retired or superseded, or users will see fixed answers "un-fix" themselves.

---

The hardest technical problem here isn't retrieval or generation — both are well-trodden — it's making the correction-override layer generalize correctly at match time. Too loose a similarity match serves someone else's correction to an unrelated question; too tight a match fails to catch a legitimate rephrasing and silently falls back to the same wrong document-derived answer the correction was meant to fix. The recommended approach is a hybrid: combine embedding similarity against the stored question with entity/topic tags extracted when the correction is created, and treat the first few times a correction is served against a new phrasing as a confirmation loop ("did this answer your question?") rather than a silent guess — letting each correction learn its own paraphrase cluster over time, with the human-reviewable audit trail as the backstop for whenever the automated matching gets it wrong.
