# Deployment

Crispr targets single-node, network-isolated on-prem / VPC deployments. All state lives under
`DATA_DIR` on storage you control.

## Option A — Docker (recommended)

```bash
export CRISPR_ENCRYPTION_SECRET="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))")"
docker compose up -d --build
```

- App listens on :3000; put your ingress (TLS 1.2+) in front of it.
- Persistent state is in the `crisp-data` volume (`/app/data` inside the container).

## Option B — bare Node

```bash
npm ci
cp .env.example .env.local   # set GROQ_API_KEY, CRISPR_ENCRYPTION_SECRET, ...
npm run build
DATA_DIR=/mnt/customer-vault/crispr npm start
```

## First-run provisioning

1. Wait for `GET /api/ready` to return 200.
2. Create the first admin (demo accounts are not seeded in production):
   ```bash
   node scripts/create-user.mjs "Dana Admin" dana@company.com 'S3cret-passphrase' --admin
   ```
3. Sign in at `/login`, invite teammates via Workspace → Members, and set their roles.

## Environment (production minimum)

| Variable | Why |
| --- | --- |
| `GROQ_API_KEY` | Answer generation |
| `CRISPR_ENCRYPTION_SECRET` | Integration credential encryption — **boot fails without it** |
| `DATA_DIR` | Root for SQLite/LanceDB/uploads on encrypted storage |
| `SLACK_SIGNING_SECRET` | Only if the Slack endpoint is used |
| `RATE_LIMIT_QUERY_PER_MIN` etc. | Optional tuning (defaults in `.env.example`) |

## Health & operations

- Liveness: `GET /api/health` — always 200 while the process is up.
- Readiness: `GET /api/ready` — 200 only when SQLite + LanceDB are reachable and prod env passes.
- Backups & rollback: see [`docs/backup.md`](backup.md).
- Vulnerability posture & accepted risks: see [`SECURITY.md`](../SECURITY.md).
