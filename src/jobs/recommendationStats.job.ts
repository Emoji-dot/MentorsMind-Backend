/**
 * Recommendation Stats Refresh Job
 *
 * Nightly refresh of mentor_recommendation_stats:
 * - CTR = clicks / impressions over the last 30 days
 * - Conversion rate = impressions that led to a booking within 48 hours
 *
 * Target: complete for all mentors within 5 minutes (single set-based upsert).
 */

import pool from "../config/database";
import { logger } from "../utils/logger.utils";

export interface RecommendationStatsRefreshResult {
  mentorsUpdated: number;
  durationMs: number;
}

class RecommendationStatsJob {
  /**
   * Recompute CTR and conversion rates for every mentor with recent events
   * (and seed zero rows for active mentors with no events so joins stay simple).
   */
  async refresh(): Promise<RecommendationStatsRefreshResult> {
    const startedAt = Date.now();

    const { rowCount } = await pool.query(`
      WITH event_counts AS (
        SELECT
          mentor_id,
          COUNT(*) FILTER (WHERE event_type = 'impression')::INTEGER AS impressions_30d,
          COUNT(*) FILTER (WHERE event_type = 'click')::INTEGER AS clicks_30d
        FROM recommendation_events
        WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY mentor_id
      ),
      conversion_counts AS (
        SELECT
          re.mentor_id,
          COUNT(DISTINCT re.id)::INTEGER AS impressions_for_conversion,
          COUNT(DISTINCT CASE WHEN b.id IS NOT NULL THEN re.id END)::INTEGER AS conversions_30d
        FROM recommendation_events re
        LEFT JOIN bookings b
          ON b.mentor_id = re.mentor_id
         AND b.mentee_id = re.learner_id
         AND b.created_at >= re.created_at
         AND b.created_at <= re.created_at + INTERVAL '48 hours'
         AND b.status IN ('pending', 'confirmed', 'in_progress', 'completed')
        WHERE re.event_type = 'impression'
          AND re.created_at >= NOW() - INTERVAL '30 days'
        GROUP BY re.mentor_id
      ),
      mentor_base AS (
        SELECT id AS mentor_id
        FROM users
        WHERE role = 'mentor' AND is_active = true
      ),
      computed AS (
        SELECT
          mb.mentor_id,
          COALESCE(ec.impressions_30d, 0) AS impressions_30d,
          COALESCE(ec.clicks_30d, 0) AS clicks_30d,
          CASE
            WHEN COALESCE(ec.impressions_30d, 0) > 0
              THEN LEAST(1.0, ec.clicks_30d::NUMERIC / ec.impressions_30d)
            ELSE 0
          END AS ctr,
          COALESCE(cc.conversions_30d, 0) AS conversions_30d,
          CASE
            WHEN COALESCE(cc.impressions_for_conversion, 0) > 0
              THEN LEAST(1.0, cc.conversions_30d::NUMERIC / cc.impressions_for_conversion)
            ELSE 0
          END AS conversion_rate
        FROM mentor_base mb
        LEFT JOIN event_counts ec ON ec.mentor_id = mb.mentor_id
        LEFT JOIN conversion_counts cc ON cc.mentor_id = mb.mentor_id
      )
      INSERT INTO mentor_recommendation_stats (
        mentor_id,
        impressions_30d,
        clicks_30d,
        ctr,
        conversions_30d,
        conversion_rate,
        updated_at
      )
      SELECT
        mentor_id,
        impressions_30d,
        clicks_30d,
        ROUND(ctr::NUMERIC, 4),
        conversions_30d,
        ROUND(conversion_rate::NUMERIC, 4),
        NOW()
      FROM computed
      ON CONFLICT (mentor_id) DO UPDATE SET
        impressions_30d = EXCLUDED.impressions_30d,
        clicks_30d = EXCLUDED.clicks_30d,
        ctr = EXCLUDED.ctr,
        conversions_30d = EXCLUDED.conversions_30d,
        conversion_rate = EXCLUDED.conversion_rate,
        updated_at = NOW()
    `);

    const durationMs = Date.now() - startedAt;
    const mentorsUpdated = rowCount ?? 0;

    logger.info("[RecommendationStatsJob] Nightly stats refresh completed", {
      mentorsUpdated,
      durationMs,
    });

    if (durationMs > 5 * 60 * 1000) {
      logger.warn("[RecommendationStatsJob] Refresh exceeded 5-minute SLA", {
        durationMs,
        mentorsUpdated,
      });
    }

    return { mentorsUpdated, durationMs };
  }
}

export const recommendationStatsJob = new RecommendationStatsJob();
export default recommendationStatsJob;
