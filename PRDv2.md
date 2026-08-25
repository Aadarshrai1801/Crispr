# Crispr v2 PRD: Collaboration, Trust, Integrations & Compounding Intelligence

## 1. Executive Summary

Crispr v1 proved a single-user thesis: PDF Q&A with a persistent correction layer that gets smarter every time a user flags a wrong answer. v2 turns that thesis into a business. It layers four new capabilities on top of the v1 correction engine — team collaboration, deeper document handling, enterprise-grade trust/compliance, and integrations into where people already work — plus a fifth pillar, compounding intelligence, that makes the product's accuracy compound across documents and users rather than resetting with every new upload.

v2 is for three buyers: the individual professional who outgrows Free's document cap (Pro), the team lead running a shared body of knowledge who needs review and accountability before a correction goes live (Team), and the enterprise buyer who needs SSO, on-prem deployment, and an SLA before Crispr can touch regulated or confidential documents (Enterprise). Each pillar maps directly to unlocking one or more of these tiers; none of it is built for its own sake.

## 2. Goals & Success Metrics

### Business goals

| Goal | Metric | Target (12 months post-launch) |
| --- | --- | --- |
| Convert Free to paid | Free → Pro conversion rate | ≥ 8% |
| Land team accounts | Pro → Team upgrade rate | ≥ 15% of Pro accounts with 2+ collaborators |
| Land enterprise accounts | Team → Enterprise upgrade rate | ≥ 5 enterprise logos in first 2 quarters post-Phase 3 |
| Expansion revenue | Net revenue retention | ≥ 115% |
| Reduce churn | Monthly logo churn (Team/Enterprise) | ≤ 2% |

### Product goals

| Goal | Metric | Target |
| --- | --- | --- |
| Fast time-to-value on corrections | Time from workspace creation to first approved correction | < 24 hours median |
| Multi-document usage is real, not vestigial | % of Team/Enterprise queries that span 2+ documents | ≥ 30% |
| Confidence scoring is trusted | % of "needs review" flagged answers that a human confirms were actually wrong | ≥ 60% (validates the threshold is well-calibrated, not noise) |
| Integrations drive engagement | % of Team/Enterprise queries originating from Slack/Teams/API vs. web app | ≥ 25% within 6 months of Phase 2 launch |
| Compounding intelligence reduces repeat work | % reduction in duplicate corrections submitted for semantically similar questions, quarter over quarter | ≥ 20% reduction by Q2 post-Phase 3 |

## 3. Personas & Use Cases

**Priya, Individual Power User (Pro)**
Priya is a freelance financial analyst who references 40+ client PDFs — prospectuses, filings, past reports. On Free she hit the 3-document cap immediately. She upgrades to Pro for unlimited documents and persistent corrections. Scenario: she uploads a new 10-K, asks Crispr to summarize a risk section, gets an answer that misstates a subsidiary's ownership percentage, flags it, and supplies the correct number. The next time she or any future query touches that section, the corrected number is returned — without her needing to remember she ever fixed it.

**Marcus, Team Lead on a Support/Compliance Team (Team)**
Marcus runs a 12-person support team that answers customer questions against a shared library of policy PDFs. Historically, if one agent corrected an answer, no one else benefited from it, and no one could tell who approved what. He upgrades to Team for a shared workspace and approval workflows. Scenario: an agent flags an outdated refund policy and submits a correction. Because policy corrections require review, the correction goes into a pending queue; Marcus reviews it against the actual policy doc, approves it, and it instantly propagates to all 12 agents. The audit log records who submitted, who approved, and when.

**Dana, Enterprise Buyer/Admin (Enterprise)**
Dana is Director of Knowledge Ops at a mid-size insurance company. Legal requires that customer policy documents never leave company infrastructure, and IT requires SSO and centralized access control before any new SaaS tool is approved. She needs an on-prem deployment, SSO integration, and a signed SLA before Crispr can be rolled out past a pilot team. Scenario: Dana's team runs Crispr in a private VPC, provisions access via the company's SSO provider, and uses the public API to embed Q&A directly into the internal claims-processing tool, so adjusters never have to leave their existing workflow.

## 4. Feature Requirements by Pillar

### Pillar A — Collaboration & Team Features

**FR-32.** Users can create a Workspace that contains a shared document library and a shared correction layer. All corrections submitted within a workspace are visible to and used by all workspace members immediately upon approval (or immediately upon submission, if the workspace has approval workflows disabled). *Minimum tier: Team.* Extends the v1 per-document correction override layer from user-scoped to workspace-scoped.

**FR-33.** Workspace admins can enable "Approval Required" mode per workspace or per document. When enabled, a submitted correction enters a Pending state and does not affect retrieval until a user with Approver or Admin role approves it. Rejected corrections are retained with a rejection reason but never enter the active override layer. *Minimum tier: Team.*

**FR-34.** Workspaces support four roles — Admin, Approver, Contributor, Viewer — with permissions enforced at the API layer: Admin (manage workspace, users, roles, integrations), Approver (approve/reject corrections, all Contributor permissions), Contributor (upload documents, submit corrections, comment), Viewer (query documents, view corrections, cannot submit). *Minimum tier: Team.*

**FR-35.** Each correction supports a threaded comment discussion, visible to all workspace members with at least Viewer access to that document. Comments are timestamped and attributed. *Minimum tier: Team.*

**FR-36.** Workspace admins can view a pending-approvals queue showing all corrections awaiting review, sortable by document, submitter, and age. *Minimum tier: Team.*

### Pillar B — Depth of Document Handling

**FR-37.** A single query can retrieve relevant passages across all documents in a workspace (or a user-selected subset) and return one synthesized answer with per-claim source citations identifying which document each claim came from. *Minimum tier: Pro (single-user multi-doc); Team/Enterprise (workspace-wide multi-doc).*

**FR-38.** Ingestion pipeline extracts structured content from tables and charts (not just surrounding prose), preserving row/column relationships so a query like "what was Q3 revenue in the table on page 12" returns the correct cell value rather than a paraphrase of nearby text. *Minimum tier: Pro.*

**FR-39.** When a user uploads a new version of a previously-ingested document, the system detects the prior version, generates a diff summary of material changes (added/removed/modified sections), and prompts the user to review whether any existing corrections on the old version still apply, are now resolved by the source update, or need to be re-flagged. *Minimum tier: Pro.*

**FR-40.** Ingestion supports Word (.docx), Excel (.xlsx), scanned/OCR'd contracts, and email thread exports (.eml/.msg) as first-class document types, with the same correction-override mechanics as PDF. *Minimum tier: Pro.*

### Pillar C — Trust & Compliance

**FR-41.** All correction and approval activity (submit, approve, reject, edit, delete) is written to an immutable, append-only audit log, exportable as CSV or JSON, including actor, timestamp, before/after state, and workspace context. *Minimum tier: Team.*

**FR-42.** Every generated answer includes a confidence score derived from retrieval relevance and source agreement. Answers below a configurable threshold are visually flagged "Needs Review" in the UI and excluded from being treated as authoritative in downstream integrations (e.g., Slack bot responses include a visible caveat). *Minimum tier: Pro (score visible); Team (threshold configurable per workspace).*

**FR-43.** The system periodically scans documents within a workspace for passages that make conflicting factual claims on the same topic (e.g., two policy PDFs stating different refund windows) and surfaces these as proactive Conflict alerts in an admin dashboard, independent of any user having queried that content. *Minimum tier: Team.*

**FR-44.** Crispr supports deployment into a customer's private cloud VPC or on-premise infrastructure, with all document storage, embeddings, and correction data remaining within the customer's environment. *Minimum tier: Enterprise.*

### Pillar D — Integrations

**FR-45.** A Slack and Microsoft Teams bot allows users to query workspace documents and receive answers (with citations and confidence flags) directly in a channel or DM, without opening the web app. *Minimum tier: Team.*

**FR-46.** A public REST API exposes document upload, query, and correction-submission endpoints under the requesting account's API key, enabling third-party products to embed Crispr's Q&A engine. *Minimum tier: Enterprise.*

**FR-47.** Zapier and Make connectors expose "new document uploaded," "correction approved," and "conflict detected" as triggers, and "query document" and "submit correction" as actions, for no-code workflow automation. *Minimum tier: Team.*

**FR-48.** Workspaces can connect Notion, Confluence, Google Drive, and SharePoint as live document sources: documents in a connected folder/space are auto-ingested and kept in sync on edit, rather than requiring manual re-upload. *Minimum tier: Team (Google Drive, Notion); Enterprise (Confluence, SharePoint, given typical enterprise-only licensing on those platforms).*

**FR-49.** A browser extension detects a PDF open in the current tab and allows the user to query it against Crispr (ingesting it on the fly if not already in their library), without leaving the page. *Minimum tier: Pro.*

### Pillar E — Compounding Intelligence

**FR-50.** When a correction is approved on one document, the system checks other documents in the same workspace for semantically similar passages and surfaces a "this may also need correcting" suggestion to an Approver, rather than waiting for an independent flag on each document. *Minimum tier: Team.*

**FR-51.** The system tracks flagged-but-not-yet-corrected questions across a workspace and, upon detecting a repeated pattern (same underlying question flagged 3+ times), proactively generates a suggested correction for Approver review rather than waiting for a user to write one from scratch. *Minimum tier: Team.*

**FR-52.** An analytics dashboard shows, per workspace: most-flagged documents, most-flagged questions/topics, correction approval/rejection rates, and time-to-approval trends, so an admin can identify which source documents are systematically unreliable. *Minimum tier: Team.*

## 5. Non-Functional Requirements

**Performance**

- Single-document query: p95 latency ≤ 2.5s (unchanged from v1 baseline).
- Multi-document query (FR-37) across up to 50 documents: p95 latency ≤ 5s; degrades gracefully (with a "narrowing search" indicator) beyond 50 documents rather than timing out.
- Slack/Teams bot response: p95 ≤ 6s end-to-end including platform round-trip.

**Security**

- RBAC (FR-34) enforced server-side on every API call, never client-side only.
- All data encrypted at rest (AES-256) and in transit (TLS 1.2+).
- On-prem deployments (FR-44) support customer-managed encryption keys.
- API keys (FR-46) scoped per-workspace with revocation and rotation support.
- Data residency: on-prem/private-cloud customers' data never transits Crispr-hosted infrastructure post-deployment.

**Scalability**

- Workspaces support up to 500 members and 50,000 documents at Enterprise tier without architectural changes; Team tier soft-capped at 25 members / 2,000 documents.
- Audit log storage scales independently of primary document store to avoid write contention during high-approval-volume periods.

**Reliability**

- Pro: 99.5% uptime, best-effort support.
- Team: 99.9% uptime, next-business-day support SLA.
- Enterprise: 99.95% uptime, contractual SLA with defined response times and credits for breach.

## 6. Data Model Changes

- **Workspace** — id, name, owner_id, created_at, approval_required (bool, per-workspace default), plan_tier.
- **WorkspaceMembership** — workspace_id, user_id, role (Admin/Approver/Contributor/Viewer), joined_at.
- **Document** (extended from v1) — adds workspace_id (nullable, null = personal), source_type (upload/gdrive/notion/confluence/sharepoint), source_connection_id, current_version_id.
- **DocumentVersion** — id, document_id, version_number, uploaded_at, uploaded_by, diff_summary (text, from FR-39).
- **Correction** (extended from v1) — adds workspace_id, status (draft/pending/approved/rejected), approved_by, approved_at, rejection_reason.
- **CorrectionComment** — id, correction_id, author_id, body, created_at.
- **AuditLogEntry** — id, workspace_id, actor_id, action_type, target_type, target_id, before_state, after_state, timestamp. Append-only; no update/delete path.
- **ConfidenceScore** — attached to each Answer record: score (0–1), threshold_at_time_of_query, flagged_needs_review (bool).
- **ConflictAlert** — id, workspace_id, document_a_id, passage_a_ref, document_b_id, passage_b_ref, detected_at, status (open/resolved/dismissed).
- **IntegrationConnection** — id, workspace_id, provider (slack/teams/gdrive/notion/confluence/sharepoint/zapier), auth_credentials (encrypted), sync_status, last_synced_at.
- **ApiKey** — id, workspace_id, key_hash, scopes, created_by, revoked_at (nullable).
- **SuggestedCorrection** — id, workspace_id, source_pattern (repeated-question cluster or cross-doc match reference), suggested_text, status (pending/accepted/dismissed), generated_at.

## 7. API Contract Additions

| Method | Path | Purpose | Auth |
| --- | --- | --- | --- |
| POST | `/v2/workspaces` | Create a workspace | User session or Enterprise API key |
| POST | `/v2/workspaces/{id}/members` | Invite/add a member with a role | Admin role required |
| POST | `/v2/documents/{id}/query?workspace_id=` | Multi-document query scoped to a workspace | Session or API key with `query` scope |
| POST | `/v2/corrections` | Submit a correction (enters pending state if approval_required) | Session or API key with `write` scope |
| POST | `/v2/corrections/{id}/approve` | Approve a pending correction | Approver/Admin role required |
| POST | `/v2/corrections/{id}/reject` | Reject a pending correction with reason | Approver/Admin role required |
| GET | `/v2/workspaces/{id}/audit-log?format=csv\|json` | Export audit log | Admin role required |
| GET | `/v2/workspaces/{id}/conflicts` | List open conflict alerts | Approver/Admin role required |
| POST | `/v2/integrations/connect` | Register a new integration connection (OAuth handshake completion) | Admin role required |
| GET | `/v2/analytics/{workspace_id}` | Retrieve flagging/approval analytics | Approver/Admin role required |

**Webhook events** (delivered to a customer-configured endpoint, used by Zapier/Make and direct integrations):

- `correction.submitted`
- `correction.approved`
- `correction.rejected`
- `conflict.detected`
- `document.version_updated`

All webhook payloads are signed (HMAC-SHA256) using a per-workspace secret so receivers can verify authenticity.

## 8. Pricing & Packaging Table

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

## 9. Rollout Plan

**Phase 1 — Team Collaboration & RBAC** (Pillar A, plus FR-37 personal multi-doc for Pro)
Rationale: this unlocks the Team tier, which is the single biggest revenue-per-account jump from Pro, and it's the smallest engineering lift of the three phases since it's primarily data-model and permissions work on top of the existing correction engine.

**Phase 2 — Trust/Compliance & Integrations** (Pillars C and D)
Rationale: audit logs, confidence scoring, and Slack/Teams integration are what actually get Team accounts to stick and what enterprise buyers ask for first in procurement. On-prem deployment and the public API are held to the end of this phase since they carry the highest engineering and support cost — build them once Team-tier revenue justifies the investment.

**Phase 3 — Compounding Intelligence** (Pillar E, plus remaining Pillar B items: FR-38–40)
Rationale: this pillar depends on having a meaningful volume of real corrections and multi-document workspaces in production to generate useful cross-document suggestions — it's not useful (and can't be well-tuned) until Phases 1–2 have generated real usage data. It's also the most differentiated, hardest-to-copy pillar, so it's the right thing to polish once the more mechanical monetization levers are already live.

## 10. Risks & Open Questions

1. **Correction conflicts in shared workspaces.** If two Contributors submit different corrections for the same passage, what's the resolution order — first-approved-wins, most-recent-wins, or does it force an Approver decision? This needs to be decided before Phase 1 ships, not discovered in production.
2. **Confidence-score calibration.** A poorly calibrated threshold will either flood users with false "needs review" flags (eroding trust) or miss genuinely wrong answers (defeating the point). Requires a labeled validation set before FR-42 ships broadly.
3. **On-prem support burden.** Enterprise on-prem deployments (FR-44) historically create outsized support and upgrade-path costs relative to revenue. Needs a clear minimum-deal-size threshold before it's offered, and a decision on whether it's a fully isolated deployment or a hybrid model.
4. **Integration auth surface area.** Each new integration (FR-45, FR-47, FR-48) is a new OAuth flow and a new place credentials can leak or be misconfigured. Needs a dedicated security review per integration before general availability, not a single blanket review.
5. **Free-tier cannibalization of Pro.** If Free's document cap or correction limits are too generous, there's no pressure to upgrade; if too stingy, it fails as a funnel. This needs to be tuned with actual conversion data post-launch rather than fixed permanently at launch.
6. **Cross-document suggestion accuracy (FR-50).** Suggesting a correction on Document B based on a correction approved on Document A risks false positives if the documents cover superficially similar but substantively different scenarios (e.g., two different jurisdictions' policies). Needs a confidence threshold of its own before suggestions surface to Approvers.
7. **SharePoint/Confluence sync reliability.** These platforms have historically inconsistent APIs and permission models; scoping this to Enterprise-only (per FR-48) may need revisiting if Team-tier customers push back on the gate.

---

v2 is what turns Crispr from a tool one person finds useful into infrastructure a team depends on and a company can safely deploy. v1's correction layer answers "is this answer right?" for one user, one document, one moment. v2 answers it at the scale that generates revenue: right for a whole team the instant it's approved, right across every document in a knowledge base rather than one at a time, verifiably right enough to pass an audit, reachable from wherever people actually work instead of only a web app, and — with compounding intelligence — increasingly right without anyone having to ask twice.
