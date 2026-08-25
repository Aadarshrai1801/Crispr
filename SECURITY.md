# Security Policy & Known Risk Acceptances

## Reporting

Report vulnerabilities privately to the maintainers (open a private security advisory on this
repository). Please do not open public issues for exploitable findings.

## Deployment security model

Crispr is designed for **single-team, network-isolated on-prem / VPC deployment**. The security
assumptions below hold in that model; re-assess before any internet-facing exposure.

- **Authentication**: session cookies (HttpOnly, SameSite=Lax; `Secure` in production) backed by a
  SQLite session store. Passwords are scrypt-hashed. Identity never comes from client-controlled
  headers.
- **Authorization**: RBAC enforced server-side on every API route (`src/lib/rbac.ts`).
- **Public API**: hashed, scoped, revocable API keys (`cris_...`, SHA-256 at rest).
- **Webhooks**: HMAC-SHA256 signed with per-endpoint secrets; Slack endpoint verifies Slack's v0
  signature scheme with a 5-minute replay window.
- **SSRF**: server-side URL fetches are validated per redirect hop — http(s) only, standard ports,
  hostname/IP denylist for loopback, RFC1918, link-local (incl. cloud metadata), CGNAT, ULA.
- **Rate limiting**: per-user/per-key token buckets on all LLM-triggering and public endpoints
  (`src/lib/rate-limit.ts`), env-tunable (`RATE_LIMIT_*_PER_MIN`).
- **Secrets**: integration credentials are AES-256-GCM encrypted at rest;
  production boot fails fast unless `CRISPR_ENCRYPTION_SECRET` is set.

## Accepted risks (tracked)

| Risk | Detail | Status |
| --- | --- | --- |
| postcss < 8.5.23 (via Next 15) | GHSA-qx2v-qp2m-jg93, GHSA-6g55-p6wh-862q, GHSA-fxqj-rqcc-2cmp, GHSA-r28c-9q8g-f849 (high) — affect CSS processing of *untrusted* stylesheet input at build time. Crispr does not process third-party CSS; exposure is limited to the build machine. | Mitigation accepted; resolved by the planned Next 16 upgrade (`npm audit fix --force` target). Track release notes for next@16. |
| sharp / libvips CVE-2026-* (via @huggingface/transformers) | high — image decode path. Only reached when OCR-ing uploaded documents from authenticated workspace members; no anonymous image input exists. | No upstream fix yet. Monitor transformers.js releases; keep uploads behind auth (enforced) and rate limits (enforced). Re-run `npm audit` after upgrade. |
| uuid via exceljs (moderate) | bounds check in v3/v5/v6 generation paths that Crispr does not exercise (we use crypto.randomUUID). | Mitigation accepted until exceljs ships uuid >= 11.1.1. |
| DNS rebinding TOCTOU in fetch-url | The SSRF guard validates DNS at request time; `fetch()` re-resolves independently. Redirect-based and literal-IP bypasses are blocked; a rebinding attacker with a short-TTL domain could theoretically race the gap. | Residual risk accepted for the on-prem pilot; revisit if fetch-url is ever exposed beyond trusted networks. |

## Operational requirements for production

1. Set `CRISPR_ENCRYPTION_SECRET` (server refuses to boot otherwise).
2. Terminate TLS 1.2+ at your ingress; set `Secure`-cookie-capable HTTPS.
3. Provision users with `node scripts/create-user.mjs "Name" email 'password' --admin`
   (demo accounts are not seeded in production).
4. Keep `DATA_DIR` on encrypted storage; back it up per `docs/backup.md`.
5. Review `query_logs` retention against your data-protection obligations;
   `scripts/purge-user-data.mjs` removes a user's queries and account.
