-- =============================================================================
-- Migration: 055_add_is_valid_to_push_tokens.sql
-- Description: Add is_valid column to push_tokens and ensure existing rows are marked valid
-- =============================================================================

ALTER TABLE push_tokens
  ADD COLUMN IF NOT EXISTS is_valid BOOLEAN DEFAULT TRUE;

-- Ensure existing nulls are set to TRUE
UPDATE push_tokens SET is_valid = TRUE WHERE is_valid IS NULL;

-- Add index for valid tokens to speed lookups
CREATE INDEX IF NOT EXISTS idx_push_tokens_valid ON push_tokens(is_valid) WHERE is_valid = TRUE;

COMMENT ON COLUMN push_tokens.is_valid IS 'Whether the FCM token has been validated as currently valid';
