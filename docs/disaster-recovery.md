# Disaster Recovery Runbook

## Overview

Backups run via `backupJob` (`src/jobs/backup.job.ts`), initialized on server
startup:

- **Daily full backup** — 02:00 UTC, `pg_dump --format=custom`-equivalent
  dump, gzip-compressed, AES-encrypted, uploaded to S3 (server-side
  encryption). Verified immediately after via `BackupService.verifyBackup`.
- **Hourly WAL switch** — triggers `pg_switch_wal()` so WAL segments roll and
  get archived. Requires `wal_level = replica` and `archive_mode = on` (see
  below) for the archived segments to support PITR replay.
- **Daily retention cleanup** — 03:00 UTC, prunes registry entries older than
  the configured retention window.

Every job run is persisted to the `backup_log` table (`id`, `backup_type`,
`status`, `s3_key`, `size_bytes`, `duration_ms`, `integrity_verified`,
`error`, timestamps) — the durable source of truth surfaced via
`GET /api/v1/admin/backup`.

## PostgreSQL PITR configuration

Point-in-time recovery requires WAL archiving enabled on the primary:

```
wal_level = replica
archive_mode = on
archive_command = 'aws s3 cp %p s3://<backup-bucket>/wal-archive/%f'
```

Apply via `ALTER SYSTEM SET ...` or the managed Postgres provider's
parameter group, then restart the instance (`wal_level`/`archive_mode`
require a restart).

## Alerting

A failed backup job or a failed integrity check logs at `high`/`critical`
severity (forwarded to Sentry automatically via `logError`,
`src/utils/error.utils.ts`) and — when `ADMIN_ALERT_EMAIL` is set — sends an
admin email via `emailService`.

## Restore procedure (operator-executed)

1. Call `POST /api/v1/admin/backup/restore` with the target `timestamp`. This
   resolves the best full-backup candidate (`BackupService.restoreToPoint`)
   without touching the live database.
2. Provision a recovery instance (or take the primary offline if this is a
   true DR event — never restore over a live primary).
3. Download and decrypt the candidate backup from its `s3_key`.
4. Restore the dump into the recovery instance.
5. Replay archived WAL segments from `wal-archive/` up to the target
   timestamp (`recovery_target_time`), using `restore_command` pointing at
   the same S3 prefix.
6. Verify row counts against `backup_log`-adjacent expectations, reconcile
   any Soroban escrows/bookings whose status may have changed since the
   backup, then cut traffic over.

## Quarterly PITR test

A CI pipeline job should periodically:

1. Trigger `POST /api/v1/admin/backup/full` against a disposable TEST
   database.
2. Restore it into a scratch schema/database.
3. Run a row-count check against the source tables.
4. Fail the pipeline (and alert) if restore or the row-count check fails.

This exercises the same code path production DR depends on, so a broken
backup is caught in CI rather than during an actual incident.
