-- Migration: create_vesting_schedules
-- Description: Create mirror table for vesting schedules from Soroban vesting contract

-- Table to mirror vesting schedules from on-chain contract
CREATE TABLE IF NOT EXISTS vesting_schedules (
    id SERIAL PRIMARY KEY,
    schedule_id INTEGER NOT NULL UNIQUE, -- On-chain schedule ID
    beneficiary_address VARCHAR(56) NOT NULL, -- Stellar address
    beneficiary_user_id UUID REFERENCES users(id) ON DELETE SET NULL, -- Link to users table if available
    total_amount BIGINT NOT NULL, -- Total vesting amount in stroops
    claimed_amount BIGINT DEFAULT 0 NOT NULL, -- Amount claimed so far
    cliff_end_timestamp BIGINT NOT NULL, -- Unix timestamp when cliff ends
    vesting_end_timestamp BIGINT NOT NULL, -- Unix timestamp when vesting ends
    start_timestamp BIGINT NOT NULL, -- Unix timestamp when vesting started
    contract_address VARCHAR(56) NOT NULL, -- Soroban contract address
    status VARCHAR(20) DEFAULT 'active' NOT NULL, -- active, revoked, completed
    vesting_type VARCHAR(50) NOT NULL, -- team, advisor, mentor_grant, investor, etc.
    notes TEXT, -- Optional notes about the schedule
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    revoked_by UUID REFERENCES users(id) ON DELETE SET NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    last_synced_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    
    CONSTRAINT vesting_schedules_status_check CHECK (status IN ('active', 'revoked', 'completed')),
    CONSTRAINT vesting_schedules_amount_check CHECK (total_amount > 0),
    CONSTRAINT vesting_schedules_claimed_check CHECK (claimed_amount >= 0 AND claimed_amount <= total_amount),
    CONSTRAINT vesting_schedules_timestamp_check CHECK (cliff_end_timestamp <= vesting_end_timestamp)
);

-- Index for querying by beneficiary
CREATE INDEX idx_vesting_schedules_beneficiary_address ON vesting_schedules(beneficiary_address);

-- Index for querying by beneficiary user ID
CREATE INDEX idx_vesting_schedules_beneficiary_user_id ON vesting_schedules(beneficiary_user_id) WHERE beneficiary_user_id IS NOT NULL;

-- Index for querying by status
CREATE INDEX idx_vesting_schedules_status ON vesting_schedules(status);

-- Index for querying by vesting type
CREATE INDEX idx_vesting_schedules_vesting_type ON vesting_schedules(vesting_type);

-- Index for querying by contract address
CREATE INDEX idx_vesting_schedules_contract_address ON vesting_schedules(contract_address);

-- Index for sync operations (find schedules needing sync)
CREATE INDEX idx_vesting_schedules_last_synced ON vesting_schedules(last_synced_at) WHERE status = 'active';

-- Index for querying schedules ending soon
CREATE INDEX idx_vesting_schedules_vesting_end ON vesting_schedules(vesting_end_timestamp) WHERE status = 'active';

-- Composite index for beneficiary + status queries
CREATE INDEX idx_vesting_schedules_beneficiary_status ON vesting_schedules(beneficiary_address, status);

-- Table to track vesting claims (audit trail)
CREATE TABLE IF NOT EXISTS vesting_claims (
    id SERIAL PRIMARY KEY,
    schedule_id INTEGER NOT NULL REFERENCES vesting_schedules(schedule_id) ON DELETE CASCADE,
    amount_claimed BIGINT NOT NULL,
    claimed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    tx_hash VARCHAR(64), -- Soroban transaction hash
    beneficiary_address VARCHAR(56) NOT NULL,
    notes TEXT,
    
    CONSTRAINT vesting_claims_amount_check CHECK (amount_claimed > 0)
);

-- Index for querying claims by schedule
CREATE INDEX idx_vesting_claims_schedule_id ON vesting_claims(schedule_id);

-- Index for querying claims by beneficiary
CREATE INDEX idx_vesting_claims_beneficiary ON vesting_claims(beneficiary_address);

-- Index for querying claims by time
CREATE INDEX idx_vesting_claims_claimed_at ON vesting_claims(claimed_at);

-- Table for vesting schedule sync status (helps detect sync issues)
CREATE TABLE IF NOT EXISTS vesting_sync_log (
    id SERIAL PRIMARY KEY,
    sync_started_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    sync_completed_at TIMESTAMPTZ,
    schedules_synced INTEGER DEFAULT 0,
    schedules_failed INTEGER DEFAULT 0,
    error_message TEXT,
    sync_duration_ms INTEGER,
    
    CONSTRAINT vesting_sync_log_counts_check CHECK (schedules_synced >= 0 AND schedules_failed >= 0)
);

-- Index for querying recent sync logs
CREATE INDEX idx_vesting_sync_log_started_at ON vesting_sync_log(sync_started_at DESC);

-- Create updated_at trigger for vesting_schedules
CREATE OR REPLACE FUNCTION update_vesting_schedules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_vesting_schedules_updated_at
    BEFORE UPDATE ON vesting_schedules
    FOR EACH ROW
    EXECUTE FUNCTION update_vesting_schedules_updated_at();

-- Comments for documentation
COMMENT ON TABLE vesting_schedules IS 'Mirror table for Soroban vesting contract schedules - enables fast querying without on-chain calls';
COMMENT ON COLUMN vesting_schedules.schedule_id IS 'On-chain schedule ID from Soroban contract';
COMMENT ON COLUMN vesting_schedules.beneficiary_address IS 'Stellar address of the beneficiary (wallet that can claim)';
COMMENT ON COLUMN vesting_schedules.beneficiary_user_id IS 'Optional link to users table if beneficiary is a registered user';
COMMENT ON COLUMN vesting_schedules.total_amount IS 'Total vesting amount in stroops (1 XLM = 10,000,000 stroops)';
COMMENT ON COLUMN vesting_schedules.claimed_amount IS 'Amount already claimed by beneficiary in stroops';
COMMENT ON COLUMN vesting_schedules.vesting_type IS 'Category: team, advisor, mentor_grant, investor, early_contributor, etc.';
COMMENT ON COLUMN vesting_schedules.last_synced_at IS 'Last time this schedule was synced with on-chain data';
COMMENT ON TABLE vesting_claims IS 'Audit trail of all vesting claims made by beneficiaries';
COMMENT ON TABLE vesting_sync_log IS 'Log of vesting schedule sync operations for monitoring';
