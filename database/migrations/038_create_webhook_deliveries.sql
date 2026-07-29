-- Migration: 038_create_webhook_deliveries
-- Tracks every outbound webhook delivery attempt

DO $$
BEGIN
    -- If webhook_deliveries doesn't exist, create it with all combined columns
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'webhook_deliveries') THEN
        CREATE TABLE webhook_deliveries (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            webhook_id      UUID REFERENCES webhooks(id) ON DELETE CASCADE,
            subscription_id UUID REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
            event           VARCHAR(100),
            event_type      TEXT,
            payload         JSONB NOT NULL,
            status          TEXT NOT NULL DEFAULT 'pending',
            attempts        INTEGER DEFAULT 0,
            attempt_number  INTEGER NOT NULL DEFAULT 1,
            last_attempt_at TIMESTAMP WITH TIME ZONE,
            next_retry_at   TIMESTAMP WITH TIME ZONE,
            response_status INTEGER,
            response_body   TEXT,
            error_message   TEXT,
            duration_ms     INTEGER,
            delivered_at    TIMESTAMP WITH TIME ZONE,
            created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );
    ELSE
        -- If it exists, add the new columns from migration 038 if they don't exist
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'webhook_deliveries' AND column_name = 'webhook_id') THEN
            ALTER TABLE webhook_deliveries ADD COLUMN webhook_id UUID REFERENCES webhooks(id) ON DELETE CASCADE;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'webhook_deliveries' AND column_name = 'event_type') THEN
            ALTER TABLE webhook_deliveries ADD COLUMN event_type TEXT;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'webhook_deliveries' AND column_name = 'attempt_number') THEN
            ALTER TABLE webhook_deliveries ADD COLUMN attempt_number INTEGER NOT NULL DEFAULT 1;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'webhook_deliveries' AND column_name = 'next_retry_at') THEN
            ALTER TABLE webhook_deliveries ADD COLUMN next_retry_at TIMESTAMP WITH TIME ZONE;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'webhook_deliveries' AND column_name = 'response_status') THEN
            ALTER TABLE webhook_deliveries ADD COLUMN response_status INTEGER;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'webhook_deliveries' AND column_name = 'response_body') THEN
            ALTER TABLE webhook_deliveries ADD COLUMN response_body TEXT;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'webhook_deliveries' AND column_name = 'duration_ms') THEN
            ALTER TABLE webhook_deliveries ADD COLUMN duration_ms INTEGER;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'webhook_deliveries' AND column_name = 'updated_at') THEN
            ALTER TABLE webhook_deliveries ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();
        END IF;
    END IF;
END $$;

-- Adjust status check constraint if it exists to support all statuses
ALTER TABLE webhook_deliveries DROP CONSTRAINT IF EXISTS webhook_deliveries_status_check;
ALTER TABLE webhook_deliveries ADD CONSTRAINT webhook_deliveries_status_check 
    CHECK (status IN ('pending', 'success', 'failed', 'retrying', 'delivered'));

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook_id   ON webhook_deliveries(webhook_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status       ON webhook_deliveries(status);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_next_retry   ON webhook_deliveries(next_retry_at)
  WHERE status = 'retrying';
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_created_at   ON webhook_deliveries(created_at DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_webhook_deliveries_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_webhook_deliveries_updated_at ON webhook_deliveries;
CREATE TRIGGER trg_webhook_deliveries_updated_at
  BEFORE UPDATE ON webhook_deliveries
  FOR EACH ROW EXECUTE FUNCTION update_webhook_deliveries_updated_at();

