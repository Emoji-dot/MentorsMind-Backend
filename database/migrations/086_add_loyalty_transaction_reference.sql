-- =============================================================================
-- Migration: 086_add_loyalty_transaction_reference.sql
-- Description: Add reference_id to loyalty_transactions so accrual actions
--              tied to a specific entity (e.g. a completed booking) can be
--              deduplicated — completing the same booking twice must not
--              double-award loyalty points (issue #680).
-- =============================================================================

ALTER TABLE loyalty_transactions ADD COLUMN IF NOT EXISTS reference_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_loyalty_transactions_action_reference
  ON loyalty_transactions(user_id, action, reference_id)
  WHERE reference_id IS NOT NULL;
