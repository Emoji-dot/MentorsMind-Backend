-- =============================================================================
-- Migration: 108_create_mentor_recommendation_stats.sql
-- Description: Per-mentor CTR and booking conversion rates for collaborative filtering
-- =============================================================================

CREATE TABLE IF NOT EXISTS mentor_recommendation_stats (
    mentor_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

    -- Rolling 30-day impression / click counts
    impressions_30d INTEGER NOT NULL DEFAULT 0,
    clicks_30d INTEGER NOT NULL DEFAULT 0,
    ctr NUMERIC(6, 4) NOT NULL DEFAULT 0
        CHECK (ctr >= 0 AND ctr <= 1),

    -- Impressions that led to a booking within 48 hours
    conversions_30d INTEGER NOT NULL DEFAULT 0,
    conversion_rate NUMERIC(6, 4) NOT NULL DEFAULT 0
        CHECK (conversion_rate >= 0 AND conversion_rate <= 1),

    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mentor_recommendation_stats_ctr
    ON mentor_recommendation_stats (ctr DESC);

CREATE INDEX IF NOT EXISTS idx_mentor_recommendation_stats_conversion
    ON mentor_recommendation_stats (conversion_rate DESC);

CREATE INDEX IF NOT EXISTS idx_mentor_recommendation_stats_updated_at
    ON mentor_recommendation_stats (updated_at);

COMMENT ON TABLE mentor_recommendation_stats IS
    'Nightly-refreshed per-mentor CTR and booking conversion rates used by RecommendationService collaborative filtering';
COMMENT ON COLUMN mentor_recommendation_stats.ctr IS
    'click_events / impression_events over the last 30 days';
COMMENT ON COLUMN mentor_recommendation_stats.conversion_rate IS
    'Share of impressions that produced a booking within 48 hours over the last 30 days';
