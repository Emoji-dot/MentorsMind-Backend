-- Migration 111: Access risk log for Zero Trust security model
-- Part of issue #839 "Implement Zero Trust Security Model": persists every
-- continuous risk assessment (score, decision, signals context) so the
-- risk-assessment service can compute historical signals such as IP/device
-- diversity and typical access-hour patterns per user.

BEGIN;

CREATE TABLE IF NOT EXISTS access_risk_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip_address TEXT,
    user_agent TEXT,
    device_fingerprint TEXT,
    risk_score INT NOT NULL,
    decision TEXT NOT NULL,
    resource TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_access_risk_log_user_created
    ON access_risk_log (user_id, created_at);

COMMIT;
