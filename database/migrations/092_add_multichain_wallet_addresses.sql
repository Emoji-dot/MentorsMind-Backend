-- =============================================================================
-- Migration: 092_add_multichain_wallet_addresses.sql
-- Description: Add optional EVM addresses to wallets for multi-chain DeFi sync
-- =============================================================================

ALTER TABLE wallets
ADD COLUMN IF NOT EXISTS ethereum_address VARCHAR(42),
ADD COLUMN IF NOT EXISTS polygon_address VARCHAR(42);

CREATE INDEX IF NOT EXISTS idx_wallets_ethereum_address
  ON wallets(ethereum_address)
  WHERE ethereum_address IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wallets_polygon_address
  ON wallets(polygon_address)
  WHERE polygon_address IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'check_wallets_ethereum_address_format'
  ) THEN
    ALTER TABLE wallets
    ADD CONSTRAINT check_wallets_ethereum_address_format
    CHECK (
      ethereum_address IS NULL
      OR ethereum_address ~ '^0x[a-fA-F0-9]{40}$'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'check_wallets_polygon_address_format'
  ) THEN
    ALTER TABLE wallets
    ADD CONSTRAINT check_wallets_polygon_address_format
    CHECK (
      polygon_address IS NULL
      OR polygon_address ~ '^0x[a-fA-F0-9]{40}$'
    );
  END IF;
END $$;

COMMENT ON COLUMN wallets.ethereum_address IS 'Optional Ethereum wallet address used for DeFi portfolio aggregation';
COMMENT ON COLUMN wallets.polygon_address IS 'Optional Polygon wallet address used for DeFi portfolio aggregation';
