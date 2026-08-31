/**
 * Streak Tracking Job
 *
 * Runs daily at 00:05 UTC.  For every user who had at least one milestone
 * completion or activity event yesterday it:
 *   1. Increments current_streak and updates longest_streak in
 *      user_activity_streaks
 *   2. Writes the current streak value into Redis (streak:current:<userId>)
 *      so the leaderboard API can apply real-time increments without waiting
 *      for the next nightly snapshot
 *
 * Users with no activity yesterday have their current_streak reset to 0 and
 * their Redis key cleared.
 */

import pool from '../config/database';
import { redis } from '../config/redis';
import { logger } from '../utils/logger.utils';

/** 30-day TTL for streak Redis keys — they are refreshed every day they are active */
const STREAK_REDIS_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface StreakTrackingResult {
  elapsed: number;
  usersProcessed: number;
  streaksIncremented: number;
  streaksReset: number;
  errors: number;
}

/**
 * Main entry point — called by the scheduler or maintenance worker.
 */
export async function runStreakTracking(): Promise<StreakTrackingResult> {
  const startTime = Date.now();
  let usersProcessed = 0;
  let streaksIncremented = 0;
  let streaksReset = 0;
  let errors = 0;

  logger.info('[StreakTracking] Starting daily streak tracking job');

  try {
    // ── 1. Find all users who had milestone activity yesterday ─────────────
    const { rows: activeYesterday } = await pool.query<{ user_id: string }>(
      `SELECT DISTINCT pe.student_id AS user_id
       FROM milestone_progress mp
       JOIN path_enrollments pe ON mp.enrollment_id = pe.id
       WHERE mp.completed_at::date = (CURRENT_DATE - INTERVAL '1 day')::date
         AND mp.status = 'completed'`
    );

    const activeUserIds = new Set(activeYesterday.map((r) => r.user_id));

    // ── 2. Load all existing streak records ────────────────────────────────
    const { rows: existingStreaks } = await pool.query<{
      user_id: string;
      current_streak: number;
      longest_streak: number;
      last_active_date: string | null;
    }>(
      `SELECT user_id, current_streak, longest_streak, last_active_date
       FROM user_activity_streaks`
    );

    const streakMap = new Map(
      existingStreaks.map((r) => [r.user_id, r])
    );

    // ── 3. Collect all enrolled users (for reset processing) ───────────────
    const { rows: allEnrolled } = await pool.query<{ student_id: string }>(
      `SELECT DISTINCT student_id FROM path_enrollments WHERE status = 'active'`
    );

    // ── 4. Process each enrolled user ──────────────────────────────────────
    const pipeline = redis.pipeline();
    const upserts: Array<{
      userId: string;
      currentStreak: number;
      longestStreak: number;
      lastActiveDate: string | null;
    }> = [];

    for (const { student_id: userId } of allEnrolled) {
      usersProcessed++;
      try {
        const existing = streakMap.get(userId);
        const wasActiveYesterday = activeUserIds.has(userId);

        let currentStreak: number;
        let longestStreak: number;
        const yesterday = new Date();
        yesterday.setUTCDate(yesterday.getUTCDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];

        if (wasActiveYesterday) {
          // Increment streak
          const prev = existing?.current_streak ?? 0;
          const lastActive = existing?.last_active_date;

          // Streak continues only if last_active_date was the day before yesterday
          // (already one day gap = streak reset, two consecutive days = continue)
          const lastActiveDayBefore =
            lastActive === getDateNDaysAgo(2) || prev === 0;

          if (lastActiveDayBefore || !lastActive) {
            currentStreak = prev + 1;
          } else {
            // More than one day gap — restart streak at 1
            currentStreak = 1;
          }

          longestStreak = Math.max(currentStreak, existing?.longest_streak ?? 0);

          upserts.push({
            userId,
            currentStreak,
            longestStreak,
            lastActiveDate: yesterdayStr,
          });

          // Write to Redis for real-time leaderboard reads
          pipeline.set(
            `streak:current:${userId}`,
            String(currentStreak),
            'EX',
            STREAK_REDIS_TTL_SECONDS
          );

          streaksIncremented++;
        } else {
          // No activity yesterday — reset streak
          currentStreak = 0;
          longestStreak = existing?.longest_streak ?? 0;

          upserts.push({
            userId,
            currentStreak,
            longestStreak,
            lastActiveDate: existing?.last_active_date ?? null,
          });

          // Remove Redis key so leaderboard reflects 0 streak
          pipeline.del(`streak:current:${userId}`);

          streaksReset++;
        }
      } catch (err) {
        errors++;
        logger.error('[StreakTracking] Error processing user streak', {
          userId,
          error: (err as Error).message,
        });
      }
    }

    // ── 5. Flush Redis pipeline ────────────────────────────────────────────
    await pipeline.exec();

    // ── 6. Bulk upsert streak records to DB ───────────────────────────────
    // Process in batches of 500 to avoid huge parameter lists
    const BATCH_SIZE = 500;
    for (let i = 0; i < upserts.length; i += BATCH_SIZE) {
      const batch = upserts.slice(i, i + BATCH_SIZE);
      await upsertStreaksBatch(batch);
    }

    const elapsed = Date.now() - startTime;
    logger.info('[StreakTracking] Completed', {
      elapsedMs: elapsed,
      usersProcessed,
      streaksIncremented,
      streaksReset,
      errors,
    });

    return { elapsed, usersProcessed, streaksIncremented, streaksReset, errors };
  } catch (err) {
    const elapsed = Date.now() - startTime;
    logger.error('[StreakTracking] Fatal error', {
      error: (err as Error).message,
      elapsedMs: elapsed,
    });
    throw err;
  }
}

/**
 * Bulk upsert a batch of streak records.
 * Uses a single multi-row INSERT ... ON CONFLICT for efficiency.
 */
async function upsertStreaksBatch(
  batch: Array<{
    userId: string;
    currentStreak: number;
    longestStreak: number;
    lastActiveDate: string | null;
  }>
): Promise<void> {
  if (batch.length === 0) return;

  // Build parameterised multi-row VALUES clause
  const values: any[] = [];
  const placeholders = batch.map((row, i) => {
    const base = i * 4;
    values.push(
      row.userId,
      row.currentStreak,
      row.longestStreak,
      row.lastActiveDate
    );
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
  });

  await pool.query(
    `INSERT INTO user_activity_streaks
       (user_id, current_streak, longest_streak, last_active_date, updated_at)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (user_id)
       DO UPDATE SET
         current_streak   = EXCLUDED.current_streak,
         longest_streak   = GREATEST(user_activity_streaks.longest_streak, EXCLUDED.longest_streak),
         last_active_date = COALESCE(EXCLUDED.last_active_date, user_activity_streaks.last_active_date),
         updated_at       = NOW()`,
    values
  );
}

/** Return a date string (YYYY-MM-DD) for N days ago in UTC */
function getDateNDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().split('T')[0];
}
