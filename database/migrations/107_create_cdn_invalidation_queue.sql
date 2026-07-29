-- Migration: Create CDN Invalidation Queue Table
-- Purpose: Store failed CDN invalidations for retry with exponential backoff

CREATE TABLE IF NOT EXISTS cdn_invalidation_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Invalidation details
  paths JSONB NOT NULL, -- Array of paths to invalidate
  provider VARCHAR(50) NOT NULL, -- 'cloudfront', 'cloudflare', or 'fastly'
  
  -- Status tracking
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, completed, failed
  attempt INT NOT NULL DEFAULT 0, -- Current attempt number
  error_message TEXT, -- Last error message
  invalidation_id VARCHAR(255), -- Provider-specific invalidation ID on success
  
  -- Timestamps and metadata
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  
  -- Indexes
  CONSTRAINT provider_check CHECK (provider IN ('cloudfront', 'cloudflare', 'fastly'))
);

-- Index for querying by status
CREATE INDEX idx_cdn_invalidation_status ON cdn_invalidation_queue(status);

-- Index for finding retryable items (status=pending and not too many attempts)
CREATE INDEX idx_cdn_invalidation_pending ON cdn_invalidation_queue(status, attempt)
WHERE status = 'pending';

-- Index for checking completed/failed items for cleanup
CREATE INDEX idx_cdn_invalidation_completed ON cdn_invalidation_queue(created_at)
WHERE status IN ('completed', 'failed');

-- Index for provider-specific queries
CREATE INDEX idx_cdn_invalidation_provider ON cdn_invalidation_queue(provider);

-- Trigger to update updated_at on row change
CREATE OR REPLACE FUNCTION update_cdn_invalidation_queue_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cdn_invalidation_queue_timestamp_trigger
BEFORE UPDATE ON cdn_invalidation_queue
FOR EACH ROW
EXECUTE FUNCTION update_cdn_invalidation_queue_timestamp();

-- Comment for clarity
COMMENT ON TABLE cdn_invalidation_queue IS 'Stores failed CDN cache invalidations for retry with exponential backoff. Failed invalidations are queued here and retried every 5 minutes for up to 24 hours.';
COMMENT ON COLUMN cdn_invalidation_queue.paths IS 'Array of CDN paths that failed to invalidate, e.g. ["[/images/avatar.jpg", "/images/avatar.webp"]';
COMMENT ON COLUMN cdn_invalidation_queue.provider IS 'CDN provider: cloudfront, cloudflare, or fastly';
COMMENT ON COLUMN cdn_invalidation_queue.status IS 'pending = waiting for retry, completed = successfully invalidated, failed = gave up after 24 hours';
COMMENT ON COLUMN cdn_invalidation_queue.attempt IS 'Number of retry attempts so far';
COMMENT ON COLUMN cdn_invalidation_queue.invalidation_id IS 'Provider ID returned on successful invalidation';
