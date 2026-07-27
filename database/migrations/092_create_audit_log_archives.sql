-- Migration: 092_create_audit_log_archives
-- Tracks batches of audit_logs rows archived to S3 (with Object Lock/WORM)
-- by AuditLogArchivalJob, so they stay queryable and auditable for the full
-- regulatory retention period after being removed from hot PostgreSQL
-- storage. See issue #772.

CREATE TABLE IF NOT EXISTS audit_log_archives (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  s3_key                TEXT NOT NULL UNIQUE,
  row_count             INTEGER NOT NULL,
  from_date             TIMESTAMP WITH TIME ZONE NOT NULL,
  to_date               TIMESTAMP WITH TIME ZONE NOT NULL,
  compressed_size_bytes BIGINT NOT NULL,
  archived_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_archives_archived_at ON audit_log_archives(archived_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_archives_date_range ON audit_log_archives(from_date, to_date);

COMMENT ON TABLE audit_log_archives IS 'Metadata for audit_logs batches archived to S3 with Object Lock (WORM) retention';
COMMENT ON COLUMN audit_log_archives.s3_key IS 'S3 object key of the gzipped NDJSON archive file';
COMMENT ON COLUMN audit_log_archives.row_count IS 'Number of audit_logs rows contained in this archive';
COMMENT ON COLUMN audit_log_archives.from_date IS 'Earliest created_at among archived rows';
COMMENT ON COLUMN audit_log_archives.to_date IS 'Latest created_at among archived rows';
COMMENT ON COLUMN audit_log_archives.compressed_size_bytes IS 'Size of the gzip-compressed NDJSON file in bytes';
