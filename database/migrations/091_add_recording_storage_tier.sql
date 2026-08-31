-- Migration 091: Add storage tier tracking columns to session_recordings
-- Issue #748: Session recording cleanup and storage tiering with S3 lifecycle management
--
-- Adds:
--   storage_tier  — tracks current S3 storage class (STANDARD | STANDARD_IA | GLACIER | DEEP_ARCHIVE | deleted)
--   tiered_at     — timestamp when the recording was last transitioned to a new tier
-- Also creates a partial index to efficiently query recordings by tier for the daily cleanup job.

ALTER TABLE session_recordings
  ADD COLUMN IF NOT EXISTS storage_tier VARCHAR(20) DEFAULT 'STANDARD';

ALTER TABLE session_recordings
  ADD COLUMN IF NOT EXISTS tiered_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_recording_storage_tier
  ON session_recordings(storage_tier, created_at)
  WHERE status = 'ready';
