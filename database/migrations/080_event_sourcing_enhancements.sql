-- =============================================================================
-- Migration: 080_event_sourcing_enhancements.sql
-- Description: Event sourcing enhancements — GIN indexes on domain_events
--              payload and metadata columns, plus optimistic concurrency
--              version column on bookings.
-- Created:     2026-07-23
-- Idempotent:  Yes — all statements use IF NOT EXISTS / IF EXISTS guards.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. GIN index on domain_events.data (payload) column
--    Enables fast JSONB containment (@>) and existence (?) queries against
--    event payloads, e.g. filtering events by aggregate ID embedded in data.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_domain_events_payload_gin
    ON domain_events
    USING GIN (data);

-- -----------------------------------------------------------------------------
-- 2. GIN index on domain_events.metadata column
--    Supports efficient queries on causedBy, correlationId, userId, and other
--    metadata fields stored as JSONB within domain events.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_domain_events_metadata_gin
    ON domain_events
    USING GIN (metadata);

-- -----------------------------------------------------------------------------
-- 3. Optimistic concurrency: version column on bookings
--    The version column is incremented on every UPDATE to a booking row.
--    Callers must supply the current version in their WHERE clause; a zero
--    rows-affected result signals a concurrent modification conflict.
--
--    IF NOT EXISTS prevents duplicate column errors on re-runs.
--    The DEFAULT 1 ensures all new rows start at version 1 without any
--    application-level intervention.
-- -----------------------------------------------------------------------------
ALTER TABLE bookings
    ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- Backfill any existing rows that somehow have a NULL version.
-- With DEFAULT 1 this is a no-op on a fresh column, but is included for
-- safety in case the column already existed without a default.
UPDATE bookings
SET    version = 1
WHERE  version IS NULL;

-- -----------------------------------------------------------------------------
-- 4. Composite index to accelerate optimistic concurrency checks
--    Queries of the form:
--      WHERE id = $1 AND version = $2
--    benefit from this index, keeping lock-contention checks sub-millisecond
--    even at large table sizes.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_bookings_version
    ON bookings (id, version);
