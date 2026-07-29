-- =============================================================================
-- Migration: 088_create_outbox_events.sql
-- Description: Transactional outbox table that pairs with src/workers/outbox.worker.ts.
--              Service writes the outbox row in the SAME DB transaction as the
--              domain entity update. The outbox worker then polls, claims with
--              SELECT ... FOR UPDATE SKIP LOCKED, dispatches to BullMQ, and
--              marks rows processed. Failed rows moved to dead_letter after a
--              max-attempt threshold. 7-day retention enforced by cleanup job.
-- =============================================================================

CREATE TYPE outbox_status AS ENUM (
    'pending',     -- Initial state, awaiting polling
    'processing',  -- Claimed by a worker (locked_until still in the future)
    'processed',   -- Successfully dispatched + confirmed
    'failed',      -- Dispatch failed but more retries allowed
    'dead_letter'  -- Exhausted retries; needs manual intervention
);

CREATE TABLE IF NOT EXISTS outbox_events (
    id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type    VARCHAR(64)  NOT NULL,
    aggregate_id      VARCHAR(255) NOT NULL,
    event_type        VARCHAR(128) NOT NULL,
    destination       VARCHAR(255) NOT NULL,
    payload           JSONB        NOT NULL DEFAULT '{}'::jsonb,
    headers           JSONB        NOT NULL DEFAULT '{}'::jsonb,

    -- Composite key preventing duplicate enqueue while leaving an audit trail.
    -- Format: "<aggregate>:<aggregate_id>:<event_type>[:<version>]"
    idempotency_key   VARCHAR(255) NOT NULL UNIQUE,

    status            outbox_status NOT NULL DEFAULT 'pending',
    attempts          INTEGER       NOT NULL DEFAULT 0,
    last_error        TEXT,

    -- Lease used to detect crashed workers. If locked_until < NOW(), the
    -- outbox worker reclaims the row and retries.
    locked_until      TIMESTAMP WITH TIME ZONE,

    created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    next_retry_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    processed_at      TIMESTAMP WITH TIME ZONE,

    correlation_id    VARCHAR(255),
    user_id           VARCHAR(255)
);

-- Hot polling index: workers repeatedly query
-- WHERE status IN ('pending','failed','processing') AND next_retry_at <= NOW()
-- ORDER BY created_at LIMIT N FOR UPDATE SKIP LOCKED
CREATE INDEX IF NOT EXISTS idx_outbox_events_polling
    ON outbox_events (status, next_retry_at)
    WHERE status IN ('pending', 'failed', 'processing');

CREATE INDEX IF NOT EXISTS idx_outbox_events_aggregate
    ON outbox_events (aggregate_type, aggregate_id);

CREATE INDEX IF NOT EXISTS idx_outbox_events_dead_letter
    ON outbox_events (status, created_at)
    WHERE status = 'dead_letter';

CREATE INDEX IF NOT EXISTS idx_outbox_events_processed_at
    ON outbox_events (processed_at)
    WHERE status = 'processed';

-- Register this migration as applied (runs inside the migration runner).
-- Idempotency: CREATE TYPE / TABLE use IF NOT EXISTS where supported.
