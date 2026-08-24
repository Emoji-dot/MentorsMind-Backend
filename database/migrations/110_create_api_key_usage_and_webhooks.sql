-- Migration 110: API key usage analytics and webhook event subscriptions
-- Part of issue #838 "API Key Management System": adds usage logging for
-- per-key analytics/monitoring, and a table for webhook event subscriptions.

BEGIN;

-- Usage logs: one row per request authenticated via an API key.
CREATE TABLE IF NOT EXISTS api_key_usage_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    api_key_id UUID NOT NULL REFERENCES integration_api_keys(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    method TEXT NOT NULL,
    status_code INT NOT NULL,
    ip_address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_key_usage_logs_key_created
    ON api_key_usage_logs (api_key_id, created_at);

-- Webhook event subscriptions attached to a developer API key.
CREATE TABLE IF NOT EXISTS api_key_webhook_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    api_key_id UUID NOT NULL REFERENCES integration_api_keys(id) ON DELETE CASCADE,
    event TEXT NOT NULL,
    target_url TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_key_webhook_subscriptions_key
    ON api_key_webhook_subscriptions (api_key_id);

COMMIT;
