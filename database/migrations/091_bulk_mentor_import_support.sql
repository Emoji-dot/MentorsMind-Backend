-- =============================================================================
-- Migration: 091_bulk_mentor_import_support.sql
-- Description: Adds indexes and ensures mentor profile columns exist to support
--              bulk mentor CSV import via the admin bulk operations pipeline.
-- Related issue: #747
-- =============================================================================

-- Ensure bulk_jobs table can accommodate the new 'mentors_import' job type.
-- The job_type column is typically VARCHAR; no schema change required for the
-- type itself, but add an index to speed up admin job-list queries filtered
-- by type and status.
CREATE INDEX IF NOT EXISTS idx_bulk_jobs_type_status
  ON bulk_jobs (job_type, status);

-- Ensure the users table has the full set of mentor profile columns that the
-- bulk import writes to.  These columns are defined in 001_create_users.sql,
-- but we guard with IF NOT EXISTS so the migration is safe to re-run.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS bio TEXT;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS expertise TEXT[];

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS hourly_rate DECIMAL(10, 2);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS years_of_experience INTEGER;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS timezone VARCHAR(50);

-- Partial index for fast bulk-imported mentor lookups
CREATE INDEX IF NOT EXISTS idx_users_bulk_imported_mentors
  ON users ((metadata->>'bulkImported'), created_at)
  WHERE role = 'mentor' AND deleted_at IS NULL;

-- Ensure expertise GIN index exists for mentor search
CREATE INDEX IF NOT EXISTS idx_users_expertise
  ON users USING GIN (expertise)
  WHERE role = 'mentor';
