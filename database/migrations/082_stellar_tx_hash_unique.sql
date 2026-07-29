-- =============================================================================
-- Migration: 082_stellar_tx_hash_unique.sql
-- Description: Add UNIQUE constraint on transactions.stellar_tx_hash to prevent replay attacks
-- =============================================================================

-- Add unique constraint to stellar_tx_hash
ALTER TABLE transactions
ADD CONSTRAINT transactions_stellar_tx_hash_key UNIQUE (stellar_tx_hash);

-- Add comment
COMMENT ON CONSTRAINT transactions_stellar_tx_hash_key ON transactions IS
  'Ensures a Stellar transaction hash can be used for at most one payment';
