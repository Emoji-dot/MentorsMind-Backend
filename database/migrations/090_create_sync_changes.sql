-- =============================================================================
-- Migration: 090_create_sync_changes.sql
-- Description: Vector-clock-based change log for offline-first mobile sync
-- =============================================================================

CREATE TABLE IF NOT EXISTS sync_changes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type   VARCHAR(50) NOT NULL CHECK (entity_type IN ('learning_goals', 'session_notes', 'booking_notes')),
  entity_id     UUID NOT NULL,
  operation     VARCHAR(10) NOT NULL CHECK (operation IN ('create', 'update', 'delete')),
  vector_clock  JSONB NOT NULL DEFAULT '{}',
  payload       JSONB NOT NULL DEFAULT '{}',
  device_id     VARCHAR(128) NOT NULL,
  cursor        BIGSERIAL,
  synced_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sync_changes_user_cursor ON sync_changes(user_id, cursor);
CREATE INDEX idx_sync_changes_entity ON sync_changes(entity_type, entity_id);
CREATE INDEX idx_sync_changes_user_entity ON sync_changes(user_id, entity_type, entity_id);
CREATE INDEX idx_sync_changes_synced_at ON sync_changes(synced_at);

COMMENT ON TABLE sync_changes IS 'Append-only change log for vector-clock-based offline sync (issue #689)';
COMMENT ON COLUMN sync_changes.cursor IS 'Monotonically increasing per-row sequence used for GET /sync/state?since= cursor pagination';

-- Each syncable entity carries its own current vector clock so the server can
-- detect concurrent edits at write time, independent of the append-only log above.
ALTER TABLE learner_goals ADD COLUMN IF NOT EXISTS vector_clock JSONB NOT NULL DEFAULT '{}';
ALTER TABLE session_notes ADD COLUMN IF NOT EXISTS vector_clock JSONB NOT NULL DEFAULT '{}';
ALTER TABLE booking_notes ADD COLUMN IF NOT EXISTS vector_clock JSONB NOT NULL DEFAULT '{}';
