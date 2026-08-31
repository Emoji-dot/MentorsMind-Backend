/**
 * Recommendation Service - Mentor Recommendation Engine
 * Scores and recommends mentors to learners based on:
 * - Skill match with learner goals / skill gaps (35%)
 * - Bayesian-smoothed rating (25%)
 * - Availability (15%)
 * - Price fit (10%)
 * - Collaborative signal: CTR + booking conversion (15%)
 */

import pool from '../config/database';
import { CacheService } from './cache.service';
import { CacheKeys, CacheTTL } from '../utils/cache-key.utils';
import { logger } from '../utils/logger.utils';

const RECOMMENDATION_CACHE_TTL = CacheTTL.long;

/** Prior mean rating used for Bayesian smoothing (neutral baseline for new mentors). */
const BAYESIAN_PRIOR_MEAN = 3.5;
/** Equivalent prior review count — higher = slower to move away from prior. */
const BAYESIAN_PRIOR_WEIGHT = 5;

/** Scoring weights (must sum to 1.0). Collaborative 15% taken from original formula. */
const WEIGHTS = {
    skill_match: 0.35,
    rating: 0.25,
    availability: 0.15,
    price_fit: 0.10,
    collaborative: 0.15,
} as const;

/** Neutral collaborative baseline when a mentor has no recorded events. */
const NEUTRAL_COLLABORATIVE_SCORE = 0.1;

export interface MentorRecommendation {
    mentor_id: string;
    first_name: string;
    last_name: string;
    email: string;
    bio: string | null;
    avatar_url: string | null;
    expertise: string[] | null;
    hourly_rate: number | null;
    average_rating: number;
    total_reviews: number;
    total_sessions_completed: number;
    is_available: boolean;
    timezone: string | null;
    score_breakdown: {
        skill_match_score: number;
        rating_score: number;
        availability_score: number;
        price_fit_score: number;
        collaborative_score: number;
        total_score: number;
    };
}

export interface RecommendationContext {
    goals: string[];
    session_history_count: number;
    skill_gaps: string[];
    learner_preferred_price_range?: { min: number; max: number };
}

export interface RecommendationEvent {
    event_type: 'impression' | 'click' | 'dismiss';
    learner_id: string;
    mentor_id: string;
    position: number;
    context: RecommendationContext;
    scoring: MentorRecommendation['score_breakdown'];
    session_id?: string;
}

export interface FeedbackEventInput {
    event_type: 'click' | 'dismiss';
    learner_id: string;
    mentor_id: string;
    position?: number;
    reason?: string;
    session_id?: string;
}

interface MentorStatsRow {
    mentor_id: string;
    ctr: string | number;
    conversion_rate: string | number;
}

class RecommendationServiceImpl {
    /**
     * Initialize method removed - table schema is now managed by migrations.
     * See: database/migrations/034_create_recommendation_events.sql
     * See: database/migrations/108_create_mentor_recommendation_stats.sql
     */

    async getRecommendedMentors(learnerId: string, limit = 5): Promise<MentorRecommendation[]> {
        const cacheKey = CacheKeys.recommendations(learnerId);
        const cached = await CacheService.get<MentorRecommendation[]>(cacheKey);
        if (cached) {
            logger.debug('[RecommendationService] Returning cached recommendations', { learnerId });
            return cached;
        }

        const context = await this.buildLearnerContext(learnerId);
        const dismissedMentorIds = await this.getDismissedMentorIds(learnerId);
        const bookedMentorIds = await this.getBookedMentorIds(learnerId, 3);

        const excludeIds = [...new Set([...dismissedMentorIds, ...bookedMentorIds])];

        const mentors = await this.scoreMentors(learnerId, context, excludeIds);
        const recommendations = mentors.slice(0, limit);

        await CacheService.set(cacheKey, recommendations, RECOMMENDATION_CACHE_TTL);

        await this.logImpressions(learnerId, recommendations, context);

        return recommendations;
    }

    private async buildLearnerContext(learnerId: string): Promise<RecommendationContext> {
        const { rows: goalsRows } = await pool.query<{ title: string }>(
            `SELECT title FROM learner_goals WHERE learner_id = $1 AND status = 'active'`,
            [learnerId],
        );

        const { rows: historyRows } = await pool.query<{ count: string }>(
            `SELECT COUNT(*) as count FROM bookings WHERE mentee_id = $1 AND status = 'completed'`,
            [learnerId],
        );

        const goals = goalsRows.map(r => r.title);
        const session_history_count = parseInt(historyRows[0]?.count || '0', 10);
        const skill_gaps = await this.identifySkillGaps(learnerId, goals);

        return { goals, session_history_count, skill_gaps };
    }

    /**
     * Compare learner goals against completed session topics (booking titles/descriptions)
     * to identify goals not yet covered by past sessions.
     */
    async identifySkillGaps(learnerId: string, goals: string[]): Promise<string[]> {
        if (goals.length === 0) {
            return [];
        }

        const { rows } = await pool.query<{ title: string; description: string | null }>(
            `SELECT title, description
             FROM bookings
             WHERE mentee_id = $1 AND status = 'completed'`,
            [learnerId],
        );

        const coveredTopics = rows
            .flatMap(r => [r.title, r.description].filter((t): t is string => Boolean(t)))
            .map(t => t.toLowerCase());

        return goals.filter(goal => {
            const goalLower = goal.toLowerCase();
            return !coveredTopics.some(
                topic => topic.includes(goalLower) || goalLower.includes(topic),
            );
        });
    }

    private async getDismissedMentorIds(learnerId: string): Promise<string[]> {
        const { rows } = await pool.query<{ mentor_id: string }>(
            `SELECT mentor_id FROM dismissed_recommendations WHERE learner_id = $1`,
            [learnerId],
        );
        return rows.map(r => r.mentor_id);
    }

    private async getBookedMentorIds(learnerId: string, minSessions: number): Promise<string[]> {
        const { rows } = await pool.query<{ mentor_id: string }>(
            `SELECT mentor_id FROM bookings
             WHERE mentee_id = $1 AND status IN ('completed', 'confirmed')
             GROUP BY mentor_id
             HAVING COUNT(*) >= $2`,
            [learnerId, minSessions],
        );
        return rows.map(r => r.mentor_id);
    }

    private async scoreMentors(
        learnerId: string,
        context: RecommendationContext,
        excludeIds: string[]
    ): Promise<MentorRecommendation[]> {
        const params: unknown[] = [];
        let excludeClause = '';

        if (excludeIds.length > 0) {
            const placeholders = excludeIds.map((_, i) => {
                params.push(excludeIds[i]);
                return `$${params.length}`;
            });
            excludeClause = `AND id NOT IN (${placeholders.join(', ')})`;
        }

        const learnerPreferredPrice = context.goals.length > 0
            ? await this.getLearnerPricePreference(learnerId)
            : null;

        // No hard average_rating >= 4.0 filter — new mentors get a Bayesian neutral score instead.
        const { rows: mentors } = await pool.query<any>(
            `SELECT u.id, u.email, u.first_name, u.last_name, u.bio, u.avatar_url, u.expertise,
                    u.hourly_rate, u.average_rating, u.total_reviews, u.total_sessions_completed,
                    u.is_available, u.timezone,
                    COALESCE(s.ctr, 0) AS ctr,
                    COALESCE(s.conversion_rate, 0) AS conversion_rate,
                    s.impressions_30d
             FROM users u
             LEFT JOIN mentor_recommendation_stats s ON s.mentor_id = u.id
             WHERE u.role = 'mentor'
               AND u.is_active = true
               AND u.is_available = true
               ${excludeClause}`,
            params,
        );

        const scoredMentors: MentorRecommendation[] = mentors.map((mentor: any) => {
            const skill_match_score = this.calculateSkillMatchScore(mentor.expertise, context);
            const rating_score = this.calculateBayesianRatingScore(
                parseFloat(mentor.average_rating) || 0,
                mentor.total_reviews || 0,
            );
            const availability_score = this.calculateAvailabilityScore(mentor.is_available, mentor.timezone);
            const price_fit_score = this.calculatePriceFitScore(
                mentor.hourly_rate,
                learnerPreferredPrice
            );
            const collaborative_score = this.calculateCollaborativeScore(
                parseFloat(String(mentor.ctr)) || 0,
                parseFloat(String(mentor.conversion_rate)) || 0,
                mentor.impressions_30d == null ? 0 : Number(mentor.impressions_30d),
            );

            const total_score =
                (skill_match_score * WEIGHTS.skill_match) +
                (rating_score * WEIGHTS.rating) +
                (availability_score * WEIGHTS.availability) +
                (price_fit_score * WEIGHTS.price_fit) +
                (collaborative_score * WEIGHTS.collaborative);

            return {
                mentor_id: mentor.id,
                first_name: mentor.first_name,
                last_name: mentor.last_name,
                email: mentor.email,
                bio: mentor.bio,
                avatar_url: mentor.avatar_url,
                expertise: mentor.expertise,
                hourly_rate: mentor.hourly_rate,
                average_rating: parseFloat(mentor.average_rating) || 0,
                total_reviews: mentor.total_reviews || 0,
                total_sessions_completed: mentor.total_sessions_completed || 0,
                is_available: mentor.is_available,
                timezone: mentor.timezone,
                score_breakdown: {
                    skill_match_score: Math.round(skill_match_score * 100) / 100,
                    rating_score: Math.round(rating_score * 100) / 100,
                    availability_score: Math.round(availability_score * 100) / 100,
                    price_fit_score: Math.round(price_fit_score * 100) / 100,
                    collaborative_score: Math.round(collaborative_score * 100) / 100,
                    total_score: Math.round(total_score * 100) / 100,
                },
            };
        });

        return scoredMentors.sort((a, b) => b.score_breakdown.total_score - a.score_breakdown.total_score);
    }

    private calculateSkillMatchScore(mentorExpertise: string[] | null, context: RecommendationContext): number {
        // Prefer skill gaps so recommendations fill uncovered learning areas.
        const matchTargets = context.skill_gaps.length > 0
            ? context.skill_gaps
            : context.goals;

        if (!mentorExpertise || mentorExpertise.length === 0 || matchTargets.length === 0) {
            return 0.3;
        }

        const expertiseLower = mentorExpertise.map(e => e.toLowerCase());
        const targetsLower = matchTargets.map(g => g.toLowerCase());

        const matchCount = targetsLower.filter(goal =>
            expertiseLower.some(exp => exp.includes(goal) || goal.includes(exp))
        ).length;

        const maxPossible = Math.max(targetsLower.length, 1);
        return Math.min(matchCount / maxPossible, 1.0);
    }

    /**
     * Bayesian-smoothed rating in [0, 1].
     * New mentors (0 reviews) score at the neutral prior (~0.7 for 3.5/5)
     * instead of being excluded by a hard average_rating >= 4.0 filter.
     */
    private calculateBayesianRatingScore(averageRating: number, totalReviews: number): number {
        const reviews = Math.max(0, totalReviews);
        const rating = Number.isFinite(averageRating) ? averageRating : 0;
        const smoothed =
            (BAYESIAN_PRIOR_WEIGHT * BAYESIAN_PRIOR_MEAN + reviews * rating) /
            (BAYESIAN_PRIOR_WEIGHT + reviews);
        return Math.min(Math.max(smoothed / 5.0, 0), 1.0);
    }

    /**
     * Collaborative signal from nightly stats: 60% CTR + 40% booking conversion.
     * Mentors with no impressions get a neutral baseline so they are not zeroed out.
     */
    private calculateCollaborativeScore(
        ctr: number,
        conversionRate: number,
        impressions30d: number,
    ): number {
        if (impressions30d <= 0) {
            return NEUTRAL_COLLABORATIVE_SCORE;
        }

        const clampedCtr = Math.min(Math.max(ctr, 0), 1);
        const clampedConversion = Math.min(Math.max(conversionRate, 0), 1);
        return (clampedCtr * 0.6) + (clampedConversion * 0.4);
    }

    private calculateAvailabilityScore(isAvailable: boolean, timezone: string | null): number {
        if (!isAvailable) return 0;
        return timezone ? 0.9 : 0.7;
    }

    private calculatePriceFitScore(
        mentorRate: number | null,
        learnerPreferred: { min: number; max: number } | null
    ): number {
        if (!mentorRate || !learnerPreferred) return 0.5;

        if (mentorRate >= learnerPreferred.min && mentorRate <= learnerPreferred.max) {
            return 1.0;
        }

        const distance = Math.min(
            Math.abs(mentorRate - learnerPreferred.min),
            Math.abs(mentorRate - learnerPreferred.max)
        );

        return Math.max(0, 1 - (distance / 50));
    }

    private async getLearnerPricePreference(learnerId: string): Promise<{ min: number; max: number } | null> {
        const { rows } = await pool.query<{ avg_rate: string }>(
            `SELECT AVG(b.amount) as avg_rate
             FROM bookings b
             WHERE b.mentee_id = $1 AND b.status IN ('completed', 'confirmed')`,
            [learnerId],
        );

        const avgRate = parseFloat(rows[0]?.avg_rate || '0');
        if (avgRate === 0) return null;

        return {
            min: Math.max(0, avgRate * 0.7),
            max: avgRate * 1.3,
        };
    }

    private async logImpressions(
        learnerId: string,
        recommendations: MentorRecommendation[],
        context: RecommendationContext
    ): Promise<void> {
        try {
            const values: unknown[] = [];
            const placeholders: string[] = [];
            let idx = 1;

            for (let i = 0; i < recommendations.length; i++) {
                const rec = recommendations[i];
                placeholders.push(
                    `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`
                );
                values.push(
                    'impression',
                    learnerId,
                    rec.mentor_id,
                    JSON.stringify(context),
                    JSON.stringify(rec.score_breakdown),
                    i + 1
                );
            }

            if (placeholders.length > 0) {
                await pool.query(
                    `INSERT INTO recommendation_events
                     (event_type, learner_id, mentor_id, context, scoring, position)
                     VALUES ${placeholders.join(', ')}`,
                    values,
                );
                logger.debug('[RecommendationService] Logged impressions', {
                    learnerId,
                    count: recommendations.length
                });
            }
        } catch (err) {
            logger.error('[RecommendationService] Failed to log impressions', {
                learnerId,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    async logEvent(event: RecommendationEvent): Promise<void> {
        try {
            await pool.query(
                `INSERT INTO recommendation_events
                 (event_type, learner_id, mentor_id, context, scoring, position, session_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                    event.event_type,
                    event.learner_id,
                    event.mentor_id,
                    JSON.stringify(event.context),
                    JSON.stringify(event.scoring),
                    event.position,
                    event.session_id || null,
                ],
            );
            logger.debug('[RecommendationService] Logged event', {
                event_type: event.event_type,
                learner_id: event.learner_id,
                mentor_id: event.mentor_id,
            });
        } catch (err) {
            logger.error('[RecommendationService] Failed to log event', {
                error: err instanceof Error ? err.message : String(err),
            });
            throw err;
        }
    }

    /**
     * Fast-path feedback logging for click/dismiss (target < 100ms).
     * Invalidates recommendation cache on dismiss.
     */
    async logFeedback(input: FeedbackEventInput): Promise<void> {
        const { event_type, learner_id, mentor_id, position, reason, session_id } = input;

        if (event_type === 'dismiss') {
            await pool.query(
                `INSERT INTO dismissed_recommendations (learner_id, mentor_id, reason)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (learner_id, mentor_id) DO UPDATE SET reason = $3, created_at = NOW()`,
                [learner_id, mentor_id, reason || null],
            );
            await CacheService.del(CacheKeys.recommendations(learner_id));
        }

        await pool.query(
            `INSERT INTO recommendation_events
             (event_type, learner_id, mentor_id, context, scoring, position, session_id)
             VALUES ($1, $2, $3, '{}', '{}', $4, $5)`,
            [event_type, learner_id, mentor_id, position ?? null, session_id || null],
        );

        logger.debug('[RecommendationService] Feedback logged', {
            event_type,
            learner_id,
            mentor_id,
        });
    }

    async dismissMentor(learnerId: string, mentorId: string, reason?: string): Promise<void> {
        await this.logFeedback({
            event_type: 'dismiss',
            learner_id: learnerId,
            mentor_id: mentorId,
            reason,
        });

        logger.info('[RecommendationService] Mentor dismissed', { learnerId, mentorId, reason });
    }

    /** Expose stats lookup for tests / debugging. */
    async getMentorStats(mentorId: string): Promise<MentorStatsRow | null> {
        const { rows } = await pool.query<MentorStatsRow>(
            `SELECT mentor_id, ctr, conversion_rate
             FROM mentor_recommendation_stats
             WHERE mentor_id = $1`,
            [mentorId],
        );
        return rows[0] || null;
    }
}

export const RecommendationService = new RecommendationServiceImpl();
