/**
 * Nightly Leaderboard Pre-computation Job
 *
 * Computes leaderboard snapshots for all active learning paths and stores the
 * results in leaderboard_snapshots.  The leaderboard API then reads from this
 * table (< 50 ms) instead of running the full multi-join SQL on every request.
 *
 * Acceptance criteria:
 *   - Runs within 30 minutes for 10,000 active users
 *   - Each user appears exactly once per leaderboard (GROUP BY bug fixed)
 *   - Only peer reviews with at least 1 liked vote count toward helpfulReviews
 *
 * Scheduled: nightly at 02:30 UTC (after the analytics refresh window)
 */

import pool from '../config/database';
import { CollaborativeLearningService } from '../services/collaborative-learning.service';
import { logger } from '../utils/logger.utils';
import { CacheService } from '../services/cache.service';

type LeaderboardType = 'milestone' | 'path' | 'global';
type LeaderboardPeriod = 'week' | 'month' | 'quarter' | 'all';

const ALL_PERIODS: LeaderboardPeriod[] = ['week', 'month', 'quarter', 'all'];
const ALL_TYPES: LeaderboardType[] = ['milestone', 'path', 'global'];

/**
 * Run the nightly leaderboard pre-computation.
 * Computes snapshots for every (type × period) combination and upserts them
 * into leaderboard_snapshots.  Path and milestone types additionally compute
 * per-entity snapshots for each active learning path / milestone.
 */
export async function runLeaderboardPrecompute(): Promise<{
  elapsed: number;
  snapshots: number;
  errors: number;
}> {
  const startTime = Date.now();
  let snapshotCount = 0;
  let errorCount = 0;

  logger.info('[LeaderboardPrecompute] Starting nightly leaderboard pre-computation');

  try {
    // ── 1. Global leaderboards ─────────────────────────────────────────────
    for (const period of ALL_PERIODS) {
      try {
        await upsertSnapshot('global', undefined, period);
        snapshotCount++;
      } catch (err) {
        errorCount++;
        logger.error('[LeaderboardPrecompute] Failed to compute global snapshot', {
          period,
          error: (err as Error).message,
        });
      }
    }

    // ── 2. Per-path leaderboards ───────────────────────────────────────────
    const { rows: activePaths } = await pool.query<{ id: string }>(
      `SELECT DISTINCT id FROM learning_paths WHERE is_published = true`
    );

    logger.info('[LeaderboardPrecompute] Computing path-level snapshots', {
      pathCount: activePaths.length,
    });

    for (const { id: pathId } of activePaths) {
      for (const period of ALL_PERIODS) {
        try {
          await upsertSnapshot('path', pathId, period);
          snapshotCount++;
        } catch (err) {
          errorCount++;
          logger.error('[LeaderboardPrecompute] Failed path snapshot', {
            pathId,
            period,
            error: (err as Error).message,
          });
        }
      }
    }

    // ── 3. Per-milestone leaderboards ──────────────────────────────────────
    // Limit to milestones that have had at least 5 completions to avoid
    // sparse snapshots for newly created milestones.
    const { rows: activeMilestones } = await pool.query<{ id: string }>(
      `SELECT m.id
       FROM milestones m
       JOIN learning_paths lp ON m.learning_path_id = lp.id
       WHERE lp.is_published = true
         AND (
           SELECT COUNT(*) FROM milestone_progress mp
           WHERE mp.milestone_id = m.id AND mp.status = 'completed'
         ) >= 5`
    );

    logger.info('[LeaderboardPrecompute] Computing milestone-level snapshots', {
      milestoneCount: activeMilestones.length,
    });

    for (const { id: milestoneId } of activeMilestones) {
      for (const period of ALL_PERIODS) {
        try {
          await upsertSnapshot('milestone', milestoneId, period);
          snapshotCount++;
        } catch (err) {
          errorCount++;
          logger.error('[LeaderboardPrecompute] Failed milestone snapshot', {
            milestoneId,
            period,
            error: (err as Error).message,
          });
        }
      }
    }

    // ── 4. Invalidate short-lived caches so next request picks up fresh data
    await CacheService.invalidatePattern('leaderboard:*');

    const elapsed = Date.now() - startTime;
    logger.info('[LeaderboardPrecompute] Completed', {
      elapsedMs: elapsed,
      snapshots: snapshotCount,
      errors: errorCount,
    });

    return { elapsed, snapshots: snapshotCount, errors: errorCount };
  } catch (err) {
    const elapsed = Date.now() - startTime;
    logger.error('[LeaderboardPrecompute] Fatal error', {
      error: (err as Error).message,
      elapsedMs: elapsed,
    });
    throw err;
  }
}

/**
 * Compute a single leaderboard using the live SQL and upsert into snapshots.
 * Uses ON CONFLICT to keep the table at exactly one row per (type, target_id, period).
 */
async function upsertSnapshot(
  type: LeaderboardType,
  targetId: string | undefined,
  period: LeaderboardPeriod
): Promise<void> {
  const leaderboard = await CollaborativeLearningService.computeLeaderboardLive(
    type,
    targetId,
    period
  );

  await pool.query(
    `INSERT INTO leaderboard_snapshots
       (type, target_id, period, entries, computed_at, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, NOW(), NOW())
     ON CONFLICT ON CONSTRAINT uq_leaderboard_snapshots_key
       DO UPDATE SET
         entries     = EXCLUDED.entries,
         computed_at = EXCLUDED.computed_at,
         updated_at  = EXCLUDED.updated_at`,
    [
      type,
      targetId ?? null,
      period,
      JSON.stringify(leaderboard.entries),
    ]
  );
}
