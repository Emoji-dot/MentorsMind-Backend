import pool from "../config/database";
import { CacheService } from "./cache.service";
import { CacheKeys, CacheTTL } from "../utils/cache-key.utils";
import { logger } from "../utils/logger.utils";

export interface RecommendedMentor {
  id: string;
  first_name: string;
  last_name: string;
  bio: string | null;
  avatar_url: string | null;
  hourly_rate: number | null;
  expertise: string[] | null;
  average_rating: number;
  total_sessions_completed: number;
  is_available: boolean;
  score: number;
}

const ALGORITHM = "collaborative_filtering";
const RECOMMENDATION_TTL = CacheTTL.long; // 1 hour

export class RecommendationService {
  /**
   * Returns ranked mentor recommendations for a learner.
   *
   * Scoring (collaborative filtering):
   *   - Skills overlap with learner interests/goals  → up to 0.40
   *   - Average rating (normalised to 0-5)           → up to 0.30
   *   - Availability                                 → 0.20 bonus
   *   - Price fit (within learner's budget)          → 0.10 bonus
   *
   * Results are cached for 1 hour per learner.
   */
  static async getRecommendedMentors(
    learnerId: string,
    limit = 10,
  ): Promise<RecommendedMentor[]> {
    const cacheKey = CacheKeys.recommendations(learnerId);

    return CacheService.wrap(cacheKey, RECOMMENDATION_TTL, async () => {
      // 1. Fetch learner context (interests, budget)
      const learnerResult = await pool.query<{
        interests: string[] | null;
        max_hourly_rate: number | null;
      }>(
        `SELECT interests, max_hourly_rate
           FROM learners
          WHERE user_id = $1`,
        [learnerId],
      );

      const learner = learnerResult.rows[0];
      const interests: string[] = learner?.interests ?? [];
      const maxRate: number | null = learner?.max_hourly_rate ?? null;

      // 2. Find learners with similar session history (collaborative signal)
      //    Returns mentor IDs that similar learners have booked.
      const similarMentorsResult = await pool.query<{ mentor_id: string }>(
        `SELECT DISTINCT b2.mentor_id
           FROM bookings b1
           JOIN bookings b2 ON b1.mentor_id = b2.mentor_id
                            AND b2.learner_id != $1
          WHERE b1.learner_id = $1
            AND b1.status = 'completed'
            AND b2.status = 'completed'
          LIMIT 50`,
        [learnerId],
      );
      const collaborativeMentorIds = similarMentorsResult.rows.map(
        (r) => r.mentor_id,
      );

      // 3. Fetch candidate mentors: collaborative picks + skill-matched mentors
      const candidates = await pool.query<
        RecommendedMentor & { expertise: string[] | null }
      >(
        `SELECT u.id,
                u.first_name,
                u.last_name,
                u.bio,
                u.avatar_url,
                u.hourly_rate,
                u.expertise,
                u.average_rating,
                u.total_sessions_completed,
                u.is_available
           FROM users u
          WHERE u.role = 'mentor'
            AND u.is_active = true
            AND (
              -- collaborative signal
              u.id = ANY($1::uuid[])
              OR
              -- skill match
              ($2::text[] IS NOT NULL AND u.expertise && $2::text[])
            )
            AND ($3::numeric IS NULL OR u.hourly_rate IS NULL OR u.hourly_rate <= $3)
          LIMIT 100`,
        [
          collaborativeMentorIds.length
            ? collaborativeMentorIds
            : ["00000000-0000-0000-0000-000000000000"],
          interests.length ? interests : null,
          maxRate,
        ],
      );

      // 4. Score each candidate
      const scored: RecommendedMentor[] = candidates.rows.map((m) => {
        const skillScore = RecommendationService.skillOverlap(
          m.expertise,
          interests,
        );
        const ratingScore = (m.average_rating ?? 0) / 5;
        const availabilityBonus = m.is_available ? 0.2 : 0;
        const priceBonus =
          maxRate == null || m.hourly_rate == null || m.hourly_rate <= maxRate
            ? 0.1
            : 0;

        const score =
          skillScore * 0.4 + ratingScore * 0.3 + availabilityBonus + priceBonus;

        return { ...m, score: parseFloat(score.toFixed(4)) };
      });

      // 5. Sort descending by score, return top N
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, limit);
    });
  }

  /** Track an impression or click event for CTR analytics */
  static async trackEvent(
    learnerId: string,
    mentorId: string,
    eventType: "impression" | "click",
    score?: number,
  ): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO recommendation_events (learner_id, mentor_id, event_type, algorithm, score)
         VALUES ($1, $2, $3, $4, $5)`,
        [learnerId, mentorId, eventType, ALGORITHM, score ?? null],
      );
    } catch (err: any) {
      logger.warn(
        { learnerId, mentorId, eventType, error: err.message },
        "Failed to track recommendation event",
      );
    }
  }

  /** Invalidate cached recommendations for a learner */
  static async invalidateCache(learnerId: string): Promise<void> {
    await CacheService.del(CacheKeys.recommendations(learnerId));
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private static skillOverlap(
    mentorExpertise: string[] | null,
    learnerInterests: string[],
  ): number {
    if (!mentorExpertise?.length || !learnerInterests.length) return 0;
    const mentorSet = new Set(mentorExpertise.map((s) => s.toLowerCase()));
    const matches = learnerInterests.filter((i) =>
      mentorSet.has(i.toLowerCase()),
    ).length;
    return Math.min(matches / learnerInterests.length, 1);
  }
}
