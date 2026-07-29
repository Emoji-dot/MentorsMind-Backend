-- Migration: 091_add_verification_retry_tracking
-- Tracks retry attempts for pending on-chain mentor verifications so the
-- retry job (issue #768) can apply exponential backoff after repeated
-- failures instead of retrying indefinitely every 2 hours.

ALTER TABLE mentor_verifications
ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE mentor_verifications
ADD COLUMN IF NOT EXISTS last_retry_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN mentor_verifications.retry_count IS 'Consecutive on-chain verification retry failures; escalates backoff to 24h after 3 failures';
COMMENT ON COLUMN mentor_verifications.last_retry_at IS 'Timestamp of the most recent on-chain verification retry attempt';
