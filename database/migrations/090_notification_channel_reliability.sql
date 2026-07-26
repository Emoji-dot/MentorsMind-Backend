-- Migration: 090_notification_channel_reliability
-- Adds per-channel notification delivery logging, a dead-letter queue for
-- channels that exhaust their independent retry budget, and a materialized
-- view of per-channel delivery rates over the last 24 hours.
-- See issue #782 (notifications.worker.ts channel isolation).

-- Per-attempt delivery log — one row per channel delivery attempt.
CREATE TABLE IF NOT EXISTS notification_channel_delivery_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id   UUID,
  job_id            TEXT,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel           TEXT NOT NULL CHECK (channel IN ('email', 'push', 'websocket')),
  status            TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'dead_letter')),
  attempt_number    INTEGER NOT NULL DEFAULT 1,
  error_message     TEXT,
  created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notif_channel_log_created ON notification_channel_delivery_log(created_at);
CREATE INDEX IF NOT EXISTS idx_notif_channel_log_channel_status ON notification_channel_delivery_log(channel, status);

-- Dead-letter queue for channels that exhaust their per-channel retry budget.
CREATE TABLE IF NOT EXISTS notification_dead_letter_queue (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id   UUID,
  job_id            TEXT,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel           TEXT NOT NULL CHECK (channel IN ('email', 'push', 'websocket')),
  type              TEXT NOT NULL,
  title             TEXT NOT NULL,
  message           TEXT NOT NULL,
  payload           JSONB NOT NULL DEFAULT '{}'::jsonb,
  failure_reason    TEXT NOT NULL,
  attempt_count     INTEGER NOT NULL,
  last_attempt_at   TIMESTAMP WITH TIME ZONE NOT NULL,
  dlq_inserted_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  admin_alerted     BOOLEAN NOT NULL DEFAULT false,
  reprocessed       BOOLEAN NOT NULL DEFAULT false,
  reprocessed_at    TIMESTAMP WITH TIME ZONE,
  created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notif_dlq_channel ON notification_dead_letter_queue(channel);
CREATE INDEX IF NOT EXISTS idx_notif_dlq_user ON notification_dead_letter_queue(user_id);
CREATE INDEX IF NOT EXISTS idx_notif_dlq_reprocessed ON notification_dead_letter_queue(reprocessed) WHERE reprocessed = false;

-- Per-channel delivery rate over the trailing 24 hours.
DROP MATERIALIZED VIEW IF EXISTS notification_delivery_status;
CREATE MATERIALIZED VIEW notification_delivery_status AS
SELECT
  channel,
  COUNT(*) FILTER (WHERE status = 'sent')::INTEGER AS sent_count,
  COUNT(*) FILTER (WHERE status = 'failed')::INTEGER AS failed_count,
  COUNT(*) FILTER (WHERE status = 'dead_letter')::INTEGER AS dead_letter_count,
  COUNT(*)::INTEGER AS total_attempts,
  ROUND(
    COUNT(*) FILTER (WHERE status = 'sent')::NUMERIC / NULLIF(COUNT(*), 0) * 100,
    2
  ) AS delivery_rate_pct,
  MAX(created_at) AS last_attempt_at
FROM notification_channel_delivery_log
WHERE created_at >= NOW() - INTERVAL '24 hours'
GROUP BY channel;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_delivery_status_channel ON notification_delivery_status(channel);

-- Extend the existing scheduled refresh function (invoked by
-- AnalyticsService.refreshViews() via analyticsRefresh.worker.ts) so this
-- view is kept current on the same cadence as the other analytics views.
CREATE OR REPLACE FUNCTION refresh_analytics_views()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_revenue;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_users;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_session_stats;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_top_mentors;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_asset_distribution;
    REFRESH MATERIALIZED VIEW CONCURRENTLY notification_delivery_status;
END;
$$ LANGUAGE plpgsql;

COMMENT ON MATERIALIZED VIEW notification_delivery_status IS 'Per-channel notification delivery rates over the trailing 24 hours (issue #782)';
COMMENT ON TABLE notification_dead_letter_queue IS 'Notification channel deliveries that exhausted their independent retry budget (issue #782)';
