-- =============================================================================
-- Migration: 088_add_session_join_timestamps.sql
-- Description: Add mentor_joined_at and mentee_joined_at timestamps to bookings
--              for session no-show detection and SLA enforcement
-- =============================================================================

-- Add join timestamp columns to bookings table
ALTER TABLE bookings
    ADD COLUMN IF NOT EXISTS mentor_joined_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS mentee_joined_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS no_show_detected_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS no_show_refund_tx_hash VARCHAR(255);

-- Create index for no-show detection queries
-- This index supports: WHERE status = 'confirmed' AND scheduled_start + interval < NOW() AND mentor_joined_at IS NULL
CREATE INDEX IF NOT EXISTS idx_bookings_no_show_detection 
    ON bookings(status, scheduled_start, mentor_joined_at)
    WHERE status = 'confirmed';

-- Add comments
COMMENT ON COLUMN bookings.mentor_joined_at IS 'Timestamp when mentor joined the session (first WebSocket connection or API join call)';
COMMENT ON COLUMN bookings.mentee_joined_at IS 'Timestamp when mentee joined the session (first WebSocket connection or API join call)';
COMMENT ON COLUMN bookings.no_show_detected_at IS 'Timestamp when no-show was detected by automated system';
COMMENT ON COLUMN bookings.no_show_refund_tx_hash IS 'Stellar transaction hash for automatic no-show refund';

