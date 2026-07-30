-- =============================================================================
-- Migration: 108_add_analytics_insights_audience.sql
-- Description: Add role-based targeting columns to analytics_insights for
--              personalized per-user insight delivery
-- =============================================================================

-- Audience for insight visibility: admin | mentor | learner | all
ALTER TABLE analytics_insights
    ADD COLUMN IF NOT EXISTS target_audience VARCHAR(20) NOT NULL DEFAULT 'all';

ALTER TABLE analytics_insights
    DROP CONSTRAINT IF EXISTS check_analytics_insights_target_audience;

ALTER TABLE analytics_insights
    ADD CONSTRAINT check_analytics_insights_target_audience
    CHECK (target_audience IN ('admin', 'mentor', 'learner', 'all'));

-- Owner of a personalized insight (NULL = platform-wide)
ALTER TABLE analytics_insights
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;

-- Entity the insight is about (mentor or learner subject)
ALTER TABLE analytics_insights
    ADD COLUMN IF NOT EXISTS entity_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- Backfill existing platform insights as admin-only (they contain revenue/growth data)
UPDATE analytics_insights
SET target_audience = 'admin'
WHERE user_id IS NULL
  AND target_audience = 'all'
  AND (
    metric_name ILIKE '%revenue%'
    OR metric_name ILIKE '%growth%'
    OR title ILIKE '%revenue%'
    OR title ILIKE '%user growth%'
  );

CREATE INDEX IF NOT EXISTS idx_analytics_insights_user_id
    ON analytics_insights (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_insights_audience
    ON analytics_insights (target_audience, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_insights_entity_id
    ON analytics_insights (entity_id)
    WHERE entity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_analytics_insights_user_unread
    ON analytics_insights (user_id, created_at DESC)
    WHERE is_read = false AND user_id IS NOT NULL;

COMMENT ON COLUMN analytics_insights.target_audience IS
    'Who may see this insight: admin, mentor, learner, or all';
COMMENT ON COLUMN analytics_insights.user_id IS
    'Personalized recipient; NULL means platform-wide (filtered by target_audience)';
COMMENT ON COLUMN analytics_insights.entity_id IS
    'The mentor or learner the insight is about';
