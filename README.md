# Crispr

**Self-correcting document Q&A that gets smarter every time you fix it.**

Crispr lets you upload documents (PDF, Word, Excel, email exports), ask natural-language questions, and get answers grounded in your files with page-level citations. What sets it apart is a built-in **correction layer**: when an answer is wrong, you flag it, supply the right answer once, and Crispr serves that corrected answer on every future match — without ever editing or re-uploading the source file.

v2 layers team collaboration, trust/compliance, integrations, and compounding intelligence on top of that engine.

---

## Table of contents

- [How it works](#how-it-works)
- [Features](#features)
- [Quick start](#quick-start)
- [Using Crispr](#using-crispr)
- [Roles & permissions](#roles--permissions)
- [Plans & feature gates](#plans--feature-gates)
- [API](#api)
- [Webhooks](#webhooks)
- [Slack bot](#slack-bot)
- [Browser extension](#browser-extension)
- [On-prem / private-cloud deployment](#on-prem--private-cloud-deployment)
- [Architecture](#architecture)
- [Data storage](#data-storage)
- [Configuration](#configuration)
- [Development](#development)

---

## How it works

Every query follows a strict precedence chain:

1. **Correction layer first** — the question is embedded and matched against persisted human corrections. A close enough match (configurable similarity threshold) returns the corrected answer instantly, labeled as such.
2. **Grounded retrieval** — if no correction matches, Crispr retrieves relevant chunks (vector search over your documents), generates an answer constrained to cite only retrieved passages, and attaches inline citations you can click to open the exact page.
3. **Flag & fix loop** — flag any wrong answer to either retry with an adjusted retrieval strategy or supply the correct answer yourself. That correction persists forever and overrides retrieval on future matches.

Corrections are versioned, auditable, and never touch the source file.

## Features

### Core (v1)

- **Multi-document chat** with clickable, page-level citations in an inline PDF viewer
- **Correction override layer** — semantic match on paraphrased questions, not just exact repeats
- **Retry with adjusted strategy** (wider top-k + stricter grounding prompt), capped at 2 attempts
- **Conflict surfacing** — submitting a near-duplicate correction prompts keep / replace / annotate instead of silently overwriting
- **Full history** of superseded corrections, plus edit/retire controls
- **OCR fallback** for scanned pages, duplicate-upload detection by hash

### Team collaboration (Pillar A)

- **Shared workspaces** — one shared document library and one shared correction layer (FR-32)
- **Approval workflows** — per-workspace "approval required" mode puts submitted corrections into a pending queue until an Approver/Admin approves them (FR-33)
- **Four roles enforced server-side**: Admin, Approver, Contributor, Viewer (FR-34)
- **Threaded comments** on every correction (FR-35)
- **Pending approvals queue** sortable by age, submitter, and document (FR-36)

### Document handling depth (Pillar B)

- **Workspace-wide queries** — one synthesized answer across every document in the workspace, with per-claim citations identifying which document each claim came from; gracefully narrows beyond 50 documents rather than timing out (FR-37)
- **Table-aware ingestion** — detected tables are kept as atomic pipe-markdown blocks preserving row/column relationships, so "what was Q3 revenue in the table" retrieves actual cells (FR-38)
- **Document versioning** — upload a new version of an existing document and Crispr produces a diff summary of added/removed/modified sections and flags existing corrections for review (FR-39)
- **First-class formats**: `.docx`, `.xlsx`, scanned PDFs (OCR), `.eml` and `.msg` email exports (FR-40)

### Trust & compliance (Pillar C)

- **Immutable audit log** — append-only record of every submit/approve/reject/edit/delete with actor, timestamp, before/after state; exportable as CSV or JSON (FR-41)
- **Confidence scoring** — every answer gets a 0–1 score derived from retrieval relevance, source agreement, and citation groundedness. Answers below the workspace threshold are flagged **Needs review** in the UI and in API responses (FR-42); the threshold is configurable per workspace
- **Proactive conflict detection** — periodic scans find passages in *different* documents making contradictory factual claims and surface them as alerts, independent of any query (FR-43)
- **On-prem/private-cloud ready** — all data lives under a single `DATA_DIR` you control (FR-44)

### Integrations (Pillar D)

- **Public REST API** with hashed, scoped, revocable API keys (`query` / `write`) — Enterprise tier (FR-46)
- **Signed webhooks** (HMAC-SHA256) for `correction.submitted/approved/rejected`, `conflict.detected`, `document.version_updated`
- **Slack bot endpoint** — point a slash command at `/api/integrations/slack/events`; low-confidence answers include a visible caveat (FR-45)
- **Integration registry** for Slack, Teams, Google Drive, Notion, Confluence, SharePoint, Zapier/Make with AES-256-GCM encrypted credentials (FR-47/48)
- **Browser extension** — ingest and query the PDF open in your current tab (FR-49)

### Compounding intelligence (Pillar E)

- **Cross-document suggestions** — after a correction is approved, similar passages in other documents surface a "this may also need correcting" suggestion for review (FR-50)
- **Repeated-flag detection** — questions flagged 3+ times without a persisted fix automatically generate a draft suggested correction (FR-51)
- **Analytics dashboard** — most-flagged documents, most-flagged topics, approval rates, time-to-approval trends (FR-52)

## Quick start

**Prerequisites:** Node.js 18+, npm. A free Groq API key (answers use Groq-hosted LLMs; embeddings run locally — no other keys needed).

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env.local
#    then set GROQ_API_KEY=... (get one at https://console.groq.com/keys)

# 3. Run the app
npm run dev
```

Open http://localhost:3000. The database, vector index, models cache, and uploads all self-initialize under `./data`.

First-run seeding creates:

- **Personal Workspace** (`ws_default`) — Team-tier so collaboration features work out of the box; approval mode off, so behavior matches classic single-user flow
- **Demo teammates** so RBAC is immediately observable via the sidebar switcher:
  - `Marcus (Team Lead)` → Approver
  - `Priya (Analyst)` → Contributor
  - `Dana (Admin)` → Viewer

> The first embedding call downloads ~25 MB model weights from HuggingFace into `data/models`; everything runs locally afterward.

### Production build

```bash
npm run build
npm start
```

## Using Crispr

1. **Documents** (`/documents`) — drag in PDFs, DOCX, XLSX, or email exports. Tables are preserved structurally; scanned PDF pages fall back to OCR. Hover a ready card to upload a **new version** (you'll get a section-level diff and a list of corrections to re-review).
2. **Chat** (`/`) — pick specific documents or hit **All documents** for a workspace-wide query. Every answer shows its confidence; anything below your threshold wears a **Needs review** badge. Citation chips open the source page inline.
3. **Fix wrong answers** — click **This is wrong**, try a smarter retry, or supply the correct answer. If approvals are enabled it enters the queue; otherwise it goes live instantly.
4. **Approvals** (`/approvals`) — the review queue, system-generated suggestions (accept → goes through the normal approval gate), and cross-document conflict alerts live here. Comment threads attach to each item.
5. **Corrections** (`/corrections`) — browse/search every correction by status (active/pending/rejected/retired), resolve post-version-update reviews, read discussions, walk supersede history.
6. **Analytics** (`/analytics`) — flag hot-spots, approval velocity, topic clusters.
7. **Workspace** (`/workspace`) — settings, members & roles, audit log exports, API keys, webhooks, integrations.

## Roles & permissions

Enforced server-side on every API call — never client-side only.

| Capability | Admin | Approver | Contributor | Viewer |
| --- | :-: | :-: | :-: | :-: |
| Query documents | ✅ | ✅ | ✅ | ✅ |
| View corrections & comments | ✅ | ✅ | ✅ | ✅ |
| Upload documents | ✅ | ✅ | ✅ | — |
| Submit corrections & comment | ✅ | ✅ | ✅ | — |
| Edit / retire own-visible corrections | ✅ | ✅ | ✅ | — |
| Approve / reject pending corrections | ✅ | ✅ | — | — |
| Manage members, roles, integrations | ✅ | — | — | — |
| Export audit log | ✅ | — | — | — |
| Create/revoke API keys | ✅ | — | — | — |

**Approval-mode semantics:** pending corrections never affect retrieval. Rejected corrections are retained with a reason but never go live. When approving would collide with an already-active near-duplicate correction, **first-approved-wins** applies — the new one can only replace it via an explicit "supersede" confirmation.

## Plans & feature gates

Tiers are set per workspace (Settings tab) and enforced by the API where meaningful.

| Feature | Free | Pro | Team | Enterprise |
| --- | :-: | :-: | :-: | :-: |
| Documents | 1–3 | Unlimited | Unlimited | Unlimited |
| Persistent corrections | — | ✅ | ✅ shared | ✅ shared |
| Workspace-wide multi-doc query | — | personal | ✅ | ✅ |
| Approval workflows, RBAC, comments | — | — | ✅ | ✅ |
| Audit log export · conflicts · suggestions · analytics | — | — | ✅ | ✅ |
| Confidence threshold config | visible only | visible only | ✅ | ✅ |
| Slack/Teams · Zapier/Make · Drive/Notion sync | — | — | ✅ | ✅ |
| Confluence/SharePoint sync | — | — | — | ✅ |
| Public API + API keys | — | — | — | ✅ |

## API

All endpoints accept `x-crisp-user-id` / `x-crisp-workspace-id` headers identifying the acting user and workspace (authorization itself is resolved server-side).

### Core (used by the web app)

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/documents` | Multipart upload (PDF/DOCX/XLSX/EML/MSG) → 202 processing |
| GET | `/api/documents` | List documents for the active workspace |
| DELETE | `/api/documents/{id}` | Cascade delete (chunks, embeddings, doc-scoped corrections) |
| POST | `/api/documents/{id}/version` | Upload new version → diff summary + corrections flagged for review |
| POST | `/api/documents/fetch-url` | Ingest a PDF directly from a URL (extension flow) |
| GET | `/api/files/{id}` | Serve stored file to the viewer |
| POST | `/api/query` | `{question, document_ids[]}` or `{question, workspace_wide:true}` → cited answer + confidence |
| POST | `/api/query/{id}/retry` | Adjusted-strategy retry (capped) |
| POST | `/api/query/original` | On-demand document-derived answer (transparency toggle) |
| POST | `/api/feedback` | Flag / confirm an answer |
| GET·POST | `/api/corrections` | List / submit corrections (auto-pends when approvals on) |
| PATCH | `/api/corrections/{id}` | `edit` · `retire` · `version_review_keep` · `version_review_reflag` |

### v2 (collaboration & trust)

| Method | Path | Purpose |
| --- | --- | --- |
| POST·GET | `/api/v2/workspaces` | Create / list workspaces |
| GET·PATCH | `/api/v2/workspaces/{id}` | Details / settings (approvals, threshold, tier) |
| GET·POST | `/api/v2/workspaces/{id}/members` | List / add members with role |
| PATCH·DELETE | `/api/v2/workspaces/{id}/members/{userId}` | Change role / remove member |
| GET | `/api/v2/corrections/pending?workspace_id=` | Pending queue |
| POST | `/api/v2/corrections/{id}/approve` | Approve (`supersede_existing` opt-in) |
| POST | `/api/v2/corrections/{id}/reject` | Reject with required reason |
| GET·POST | `/api/v2/corrections/{id}/comments` | Threaded discussion |
| GET | `/api/v2/workspaces/{id}/audit-log?format=json\|csv` | Audit export (Admin) |
| GET·POST | `/api/v2/workspaces/{id}/conflicts` | List alerts / run scan |
| PATCH | `/api/v2/conflicts/{id}` | Resolve / dismiss |
| GET·POST | `/api/v2/workspaces/{id}/suggestions` | Suggestions list / re-run flag analysis |
| POST | `/api/v2/suggestions/{id}` | Accept (→ normal approval gate) / dismiss |
| GET | `/api/v2/analytics/{workspaceId}` | Dashboard aggregates |

### Public REST API (Enterprise, API-key auth)

```bash
curl -H "Authorization: Bearer cris_YOUR_SECRET" \
     -H "Content-Type: application/json" \
     -d '{"question":"What was Q3 revenue?","workspace_wide":true}' \
     http://localhost:3000/api/public/query
```

| Method | Path | Scope |
| --- | --- | --- |
| POST | `/api/public/query` | `query` |
| POST | `/api/public/documents` (multipart) | `write` |
| POST | `/api/public/corrections` | `write` |

Responses include `confidence.flagged_needs_review`; treat flagged answers as non-authoritative downstream.

## Webhooks

Register endpoints under **Workspace → Webhooks** and subscribe to events. Every delivery includes:

```
X-Crisp-Event: correction.approved
X-Crisp-Timestamp: 1756100000
X-Crisp-Signature: t=1756100000,v1=<hex hmac-sha256(secret, "<timestamp>.<body>")>
```

Verify with the same HMAC construction using the signing secret shown once at creation time.

## Slack bot

1. In Slack, create a slash command (e.g. `/crisp`) pointing at `POST {your-app}/api/integrations/slack/events`.
2. Set `SLACK_DEFAULT_WORKSPACE_ID` (and optionally `SLACK_SIGNING_SECRET`) in `.env.local`.
3. `/crisp What is the refund window?` → answered in-channel with citations; low-confidence answers carry a ⚠️ caveat.

## Browser extension

Load the `extension/` folder as an unpacked Chrome/Edge extension (see [`extension/README.md`](extension/README.md)). With a PDF open in any tab, click the toolbar icon to ingest it into your workspace and jump straight into chat scoped to it.

## On-prem / private-cloud deployment

Everything Crispr persists — raw files, SQLite metadata, LanceDB vectors, model cache — lives under a single directory:

```bash
DATA_DIR=/mnt/customer-vault/crispr npm start
```

Checklist for customer environments:

- Point `DATA_DIR` at customer-managed encrypted storage (AES-256 at rest)
- Terminate TLS 1.2+ at your ingress
- Set `CRISPR_ENCRYPTION_SECRET` (integration credential encryption key)
- No outbound calls except Groq inference + HuggingFace model download (cacheable offline by pre-seeding `data/models`)

Data never transits any third-party service other than the configured LLM provider.

## Architecture

```
Next.js 15 (App Router, React 19, Tailwind 4)
├── Ingestion   unpdf/tesseract OCR · mammoth (docx) · exceljs (xlsx) · eml/msg parsers
│               → table-preserving chunker → local embeddings → LanceDB
├── Retrieval   correction-index match first → vector search (top-k / retry top-k)
│               → Groq generation with citation-only grounding → confidence scoring
├── Corrections status machine: pending → active | rejected (+ retired/superseded)
│               → vector override index synced only when active (approved)
├── Trust       append-only audit log · conflict scanner (pairwise cosine + LLM verdicts)
│               · suggestion engine (cross-doc FR-50, repeated flags FR-51) · analytics
└── Platform    RBAC middleware · HMAC webhooks · API-key public API · Slack endpoint
```

- **LLM**: Groq (`GROQ_MODEL`, default `openai/gpt-oss-120b`)
- **Embeddings**: `all-MiniLM-L6-v2` via transformers.js — fully local, 384-dim
- **Vector store**: LanceDB (cosine distance), separate `chunks` and `corrections_index` tables
- **Relational store**: SQLite (WAL) via better-sqlite3

## Data storage

```
data/
├── crisp.db          # documents, corrections, memberships, audit log, conflicts, keys…
├── lancedb/          # chunk vectors + correction override index
├── uploads/          # original files (+ versions/<docId>/ archives)
└── models/           # cached embedding model weights
```

Deleting a document cascades to its chunks, embeddings, and document-scoped corrections; workspace-scoped corrections persist by design. The audit log is append-only — there is no update or delete path.

## Configuration

See [`.env.example`](.env.example) for the full annotated list. Highlights:

| Variable | Default | Purpose |
| --- | --- | --- |
| `GROQ_API_KEY` / `GROQ_MODEL` | — / `openai/gpt-oss-120b` | Answer generation |
| `EMBEDDING_MODEL` | `Xenova/all-MiniLM-L6-v2` | Local embeddings |
| `CORRECTION_MATCH_THRESHOLD` | `0.80` | Similarity to serve a stored correction |
| `CONFIDENCE_THRESHOLD` | `0.55` | Default "needs review" cutoff (per-workspace overridable) |
| `MAX_RETRIES` | `2` | Automatic retry cap before prompting for a manual correction |
| `DATA_DIR` | `./data` | Root for all persisted state (relocate for on-prem) |
| `CRISPR_ENCRYPTION_SECRET` | dev default | AES-256-GCM key for integration credentials |
| `SLACK_DEFAULT_WORKSPACE_ID` | `ws_default` | Workspace used by the Slack endpoint |

## Development

```bash
npm run dev         # dev server (turbopack)
npm run build       # production build
npm start           # serve production build
npm run typecheck   # strict TypeScript check
```

Useful things to know while hacking:

- Schema changes belong in `src/lib/db.ts::migrate()` — always additive (`ensureColumn` guards make upgrades safe on existing databases)
- Role checks go through `src/lib/rbac.ts`; never trust client-side gating
- Any mutation of corrections/approvals should write an `audit.write(...)` entry
- Webhook dispatch (`dispatchWebhook`) is fire-and-forget and must stay non-blocking
