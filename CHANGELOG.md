# Changelog

All notable changes to Crispr are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is SemVer.

## [Unreleased]

### Security (deployment-readiness remediation)

- **Authentication**: real session-based sign-in (HttpOnly cookie + SQLite session store,
  scrypt password hashing). The spoofable `x-crisp-user-id` header is no longer trusted anywhere.
  Passwordless dev-only identity switcher preserved for local demos; production accounts are
  provisioned via `scripts/create-user.mjs`.
- **Slack endpoint** now verifies Slack's HMAC v0 request signature with a 5-minute replay window.
- **SSRF guard** on URL ingestion: per-redirect-hop validation of scheme/port/host against
  loopback, RFC1918, link-local (incl. cloud metadata), CGNAT, and IPv6 private ranges.
- **Rate limiting** on all LLM-backed, write, auth, and public endpoints (token buckets,
  env-tunable `RATE_LIMIT_*_PER_MIN`, 429 + `Retry-After`).
- Production boot **fails fast** unless `CRISPR_ENCRYPTION_SECRET` is set (no silent dev fallback).
- Security headers (CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy)
  plus an explicit credential-free CORS policy for `/api/public/*`.
- `/api/files/{id}` now requires workspace membership.

### Added

- `/api/health` (liveness) and `/api/ready` (readiness: SQLite, LanceDB, migrations, prod env).
- Vitest suite (65 tests): RBAC matrix, approval state machine incl. first-approved-wins,
  correction-first precedence, Slack/HMAC signing vectors, SSRF checks, rate limiter.
- GitHub Actions CI: install → typecheck → lint → tests → clean production build.
- Durable SQLite-backed ingestion queue with retries and crash recovery (replaces in-memory array).
- Backup/restore procedure (`scripts/backup.mjs`, `docs/backup.md`) and GDPR-style user data
  purge (`scripts/purge-user-data.mjs`).
- Dockerfile + docker-compose with healthchecks; rollback guidance in `docs/deploy.md`.
- OpenAPI spec for the public REST API (`docs/openapi.yaml`); `SECURITY.md` risk register.

### Changed

- Errors returned to clients are generic; full detail goes to structured pino logs only.
- Background pipelines log through pino (JSON, redacted) instead of bare `console.*`; webhook
  failure logs never include endpoint URLs.
- `npm run build` always starts from a clean `.next` (fixes Turbopack dev/build collision).
- Demo teammate accounts are seeded only outside production runtimes.
- New indexes: `corrections(workspace_id, status)`, `query_logs(workspace_id, created_at)`,
  `query_logs(user_id)`, `ingest_jobs(status, created_at)`.

## [0.2.0]

- v2 pillars: workspaces/RBAC/approvals/comments, document versions & table-aware ingestion,
  audit log/conflicts/analytics, public API/webhooks/Slack/extension, suggestions engine.

## [0.1.0]

- Core self-correcting document Q&A: ingestion, grounded answers with citations, correction
  override layer, retry strategy, OCR fallback.
