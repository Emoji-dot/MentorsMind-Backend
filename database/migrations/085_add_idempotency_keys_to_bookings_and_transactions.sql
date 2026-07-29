-- =============================================================================
-- Migration: 085_add_idempotency_keys_to_bookings_and_transactions.sql
-- Description: Add idempotency_key columns as a DB-level backstop against
--              duplicate bookings/payments (issue #662). Redis is the primary
--              idempotency cache; these UNIQUE constraints protect against
--              duplicates even if the Redis cache is cleared or unavailable.
-- =============================================================================

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bookings_mentee_idempotency_key
  ON bookings(mentee_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_user_idempotency_key
  ON transactions(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
