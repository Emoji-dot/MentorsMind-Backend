-- =============================================================================
-- Migration: 084_add_downloaded_at_to_export_jobs.sql
-- Description: Track when a completed data export was actually downloaded
-- =============================================================================

ALTER TABLE export_jobs ADD COLUMN IF NOT EXISTS downloaded_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN export_jobs.downloaded_at IS 'Timestamp of the first successful presigned URL access, NULL if never downloaded';
