-- Migration: create forecasting materialized views
-- Issue #763: PredictiveEngineService depends on these relations.

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_revenue_time_series AS
SELECT
  DATE(created_at) AS date,
  COALESCE(currency, 'XLM') AS currency,
  COALESCE(SUM(amount), 0)::DECIMAL(20, 7) AS total_amount,
  COUNT(*)::INTEGER AS transaction_count
FROM transactions
WHERE status = 'completed'
  AND type IN ('payment', 'deposit', 'escrow_release')
GROUP BY DATE(created_at), COALESCE(currency, 'XLM');

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_revenue_time_series_unique
  ON mv_revenue_time_series(date, currency);

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_hourly_session_demand AS
SELECT
  DATE_TRUNC('hour', scheduled_start) AS hour,
  EXTRACT(DOW FROM scheduled_start)::INTEGER AS day_of_week,
  EXTRACT(HOUR FROM scheduled_start)::INTEGER AS hour_of_day,
  COUNT(*)::INTEGER AS booking_count,
  COUNT(DISTINCT mentor_id)::INTEGER AS active_mentors
FROM bookings
WHERE scheduled_start IS NOT NULL
  AND status NOT IN ('cancelled', 'no_show')
GROUP BY
  DATE_TRUNC('hour', scheduled_start),
  EXTRACT(DOW FROM scheduled_start),
  EXTRACT(HOUR FROM scheduled_start);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_hourly_session_demand_unique
  ON mv_hourly_session_demand(hour);

