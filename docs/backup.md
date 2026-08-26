# Backup & Restore

All persistent state lives under `DATA_DIR` (default `./data`):

| Path | Contents |
| --- | --- |
| `crisp.db` (+ `-wal`, `-shm`) | documents metadata, corrections, memberships, sessions, audit log |
| `lancedb/` | chunk vectors + correction override index |
| `uploads/` | original files and version archives |
| `models/` | cached embedding model weights (safe to re-download; skip in backups if size matters) |

## Backup

```bash
node scripts/backup.mjs                # -> ./backups/<timestamp>/
node scripts/backup.mjs /mnt/backups   # explicit target
```

- SQLite is snapshotted with its online backup API — safe to run while the server serves traffic.
- LanceDB + uploads are plain directory copies; run when ingestion is idle (no rows in
  `ingest_jobs` with status `pending`/`processing`) for a perfectly consistent set.
- Schedule daily runs (cron/Task Scheduler) against durable storage. Retention: keep ≥7 daily
  and ≥4 weekly snapshots.

## Restore

1. Stop the app (`docker compose down` or stop the process).
2. Replace `DATA_DIR` contents:
   ```bash
   rm -rf "$DATA_DIR"/crisp.db* "$DATA_DIR"/lancedb "$DATA_DIR"/uploads
   cp backup/crisp.db        "$DATA_DIR"/crisp.db
   cp -r backup/lancedb      "$DATA_DIR"/lancedb
   cp -r backup/uploads      "$DATA_DIR"/uploads
   ```
3. Start the app. Migrations are additive and idempotent, so a restore from an older schema
   version upgrades itself on boot.
4. Verify `GET /api/ready` returns 200 before re-opening access.

## Rollback of releases

Migrations never destroy columns or tables, so running an older build after a failed deploy is
safe:

```bash
docker compose pull && CRISPR_VERSION=<previous-tag> docker compose up -d
```

If you must roll back data as well, restore the most recent backup taken **before** the deploy.
