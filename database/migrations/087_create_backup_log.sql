-- =============================================================================
-- Migration: 087_create_backup_log.sql
-- Description: Durable record of backup jobs (issue #690). BackupService
--              previously tracked jobs only in an in-memory Map, which is
--              lost on process restart; this table is the source of truth
--              for GET /api/v1/admin/backups.
-- =============================================================================

CREATE TABLE IF NOT EXISTS backup_log (
  id UUID PRIMARY KEY,
  backup_type TEXT NOT NULL CHECK (backup_type IN ('full', 'incremental', 'wal')),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  s3_key TEXT,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  integrity_verified BOOLEAN NOT NULL DEFAULT FALSE,
  error TEXT,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backup_log_started_at ON backup_log(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_backup_log_type_status ON backup_log(backup_type, status);
