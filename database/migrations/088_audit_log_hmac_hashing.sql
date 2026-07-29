-- =============================================================================
-- Migration: 088_audit_log_hmac_hashing.sql
-- Description: Ensure tamper-evident hash columns exist on audit_logs table
--              and enforce append-only policy via DB triggers.
--              Supports SOC 2 Type II compliance and forensic investigations.
-- =============================================================================

-- Enable pgcrypto extension if not already available (needed for digest/hmac)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Add record_hash column if it doesn't already exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'audit_logs' AND column_name = 'record_hash'
    ) THEN
        ALTER TABLE audit_logs ADD COLUMN record_hash VARCHAR(64);
    END IF;
END $$;

-- Add previous_hash column if it doesn't already exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'audit_logs' AND column_name = 'previous_hash'
    ) THEN
        ALTER TABLE audit_logs ADD COLUMN previous_hash VARCHAR(64);
    END IF;
END $$;

-- Add hash_algorithm column to document which algorithm was used
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'audit_logs' AND column_name = 'hash_algorithm'
    ) THEN
        ALTER TABLE audit_logs ADD COLUMN hash_algorithm VARCHAR(20) DEFAULT 'hmac-sha256';
    END IF;
END $$;

-- Create index on record_hash for integrity verification queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_record_hash ON audit_logs(record_hash);

-- Create index on previous_hash for chain traversal
CREATE INDEX IF NOT EXISTS idx_audit_logs_previous_hash ON audit_logs(previous_hash);

-- Ensure the append-only triggers exist (prevent UPDATE/DELETE on audit_logs)
CREATE OR REPLACE FUNCTION prevent_audit_log_modification()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'Audit logs are immutable — updates are not permitted (SOC 2 compliance)';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Audit logs are immutable — deletes are not permitted (SOC 2 compliance)';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Drop and recreate triggers to ensure they exist regardless of prior migration state
DROP TRIGGER IF EXISTS trg_prevent_audit_log_update ON audit_logs;
CREATE TRIGGER trg_prevent_audit_log_update
    BEFORE UPDATE ON audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION prevent_audit_log_modification();

DROP TRIGGER IF EXISTS trg_prevent_audit_log_delete ON audit_logs;
CREATE TRIGGER trg_prevent_audit_log_delete
    BEFORE DELETE ON audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION prevent_audit_log_modification();

-- Update table comment
COMMENT ON COLUMN audit_logs.record_hash IS 'HMAC-SHA256 hash of this record for tamper detection (computed in application layer)';
COMMENT ON COLUMN audit_logs.previous_hash IS 'Hash of the chronologically previous audit log entry — forms a verifiable chain';
COMMENT ON COLUMN audit_logs.hash_algorithm IS 'Algorithm used for record_hash computation';
