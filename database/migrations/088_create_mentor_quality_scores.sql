-- =============================================================================
-- Migration: 088_create_mentor_quality_scores.sql
-- Description: Mentor quality scoring pipeline — booking stats view, scores table
-- =============================================================================

-- Extends the v_mentor_booking_stats view (originally defined in database/schema.sql)
-- with a response-time dimension needed by the quality scoring formula. Column
-- names for existing fields are preserved for backward compatibility with any
-- existing consumers of the view.
CREATE OR REPLACE VIEW v_mentor_booking_stats AS
SELECT
  mentor_id,
  COUNT(*) AS total_bookings,
  SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_bookings,
  SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_bookings,
  SUM(CASE WHEN status = 'no_show' THEN 1 ELSE 0 END) AS no_show_count,
  SUM(CASE WHEN status = 'completed' THEN mentor_payout ELSE 0 END) AS total_earnings,
  AVG(CASE WHEN status = 'completed' THEN amount ELSE NULL END) AS avg_session_price,
  AVG(EXTRACT(EPOCH FROM (updated_at - created_at)))
    FILTER (WHERE status IN ('confirmed', 'completed')) AS avg_response_seconds
FROM bookings
GROUP BY mentor_id;

COMMENT ON VIEW v_mentor_booking_stats IS 'Per-mentor booking outcome stats used by SessionQualityService and admin analytics';

CREATE TABLE IF NOT EXISTS mentor_quality_scores (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id                UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score                    NUMERIC(5, 2) NOT NULL,
  tier                     VARCHAR(20) NOT NULL CHECK (tier IN ('excellent', 'good', 'needs_improvement', 'at_risk')),
  completion_rate          NUMERIC(5, 2) NOT NULL,
  avg_rating               NUMERIC(5, 2) NOT NULL,
  response_time_score      NUMERIC(5, 2) NOT NULL,
  cancellation_penalty     NUMERIC(5, 2) NOT NULL,
  computed_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_at               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mentor_quality_scores_mentor_id ON mentor_quality_scores(mentor_id);
CREATE INDEX idx_mentor_quality_scores_computed_at ON mentor_quality_scores(computed_at);
CREATE INDEX idx_mentor_quality_scores_mentor_computed ON mentor_quality_scores(mentor_id, computed_at DESC);
CREATE INDEX idx_mentor_quality_scores_tier ON mentor_quality_scores(tier);

COMMENT ON TABLE mentor_quality_scores IS 'Nightly-computed mentor quality scores with dimension breakdowns';

-- Tracks consecutive "at risk" (score < 50) days per mentor and whether
-- automated actions (warning email, suspension flag) have already fired,
-- so the alert pipeline stays idempotent across cron runs.
CREATE TABLE IF NOT EXISTS mentor_quality_alerts (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id                   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  consecutive_at_risk_days    INT NOT NULL DEFAULT 0,
  last_tier                   VARCHAR(20),
  last_warning_sent_at        TIMESTAMP WITH TIME ZONE,
  suspension_flagged_at       TIMESTAMP WITH TIME ZONE,
  updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (mentor_id)
);

COMMENT ON TABLE mentor_quality_alerts IS 'Per-mentor alert/suspension state derived from consecutive quality score history';

ALTER TABLE users ADD COLUMN IF NOT EXISTS quality_score NUMERIC(5, 2);
ALTER TABLE users ADD COLUMN IF NOT EXISTS quality_tier VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS search_visibility_reduced BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspension_flagged BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS admin_review_tasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type     VARCHAR(50) NOT NULL,
  subject_id    UUID NOT NULL,
  reason        TEXT NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_review', 'resolved', 'dismissed')),
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  resolved_at   TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_admin_review_tasks_status ON admin_review_tasks(status);
CREATE INDEX idx_admin_review_tasks_subject ON admin_review_tasks(subject_id);

COMMENT ON TABLE admin_review_tasks IS 'Generic admin review queue; used by quality-score suspension flags among other automated triggers';
