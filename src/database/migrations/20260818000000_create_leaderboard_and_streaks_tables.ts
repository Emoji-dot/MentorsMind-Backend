import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: create leaderboard_snapshots and user_activity_streaks tables
 *
 * leaderboard_snapshots — stores pre-computed leaderboard results from the
 * nightly job so the API can respond in < 50ms from a single indexed lookup
 * instead of running complex multi-join SQL on every request.
 *
 * user_activity_streaks — tracks consecutive-day activity (at least one
 * milestone completion per day) so streak_days can be served from the DB
 * and incremented via the daily streak cron job.
 */
export class CreateLeaderboardAndStreaksTables1755561600000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── leaderboard_snapshots ────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS leaderboard_snapshots (
        id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        type          VARCHAR(20) NOT NULL CHECK (type IN ('milestone','path','global')),
        target_id     UUID        NULL,
        period        VARCHAR(20) NOT NULL CHECK (period IN ('week','month','quarter','all')),
        entries       JSONB       NOT NULL DEFAULT '[]',
        computed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    /* Each (type, target_id, period) combination has at most one active
       snapshot. A NULL target_id is used for global leaderboards so we use
       COALESCE to make the unique constraint work with NULLs. */
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_leaderboard_snapshots_key
        ON leaderboard_snapshots (type, COALESCE(target_id::text, ''), period);
    `);

    /* Fast lookup by computed_at for pruning stale snapshots */
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_leaderboard_snapshots_computed_at
        ON leaderboard_snapshots (computed_at DESC);
    `);

    // ── user_activity_streaks ────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_activity_streaks (
        id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id           UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        current_streak    INT         NOT NULL DEFAULT 0,
        longest_streak    INT         NOT NULL DEFAULT 0,
        last_active_date  DATE        NULL,
        streak_started_at DATE        NULL,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_user_activity_streaks_user_id UNIQUE (user_id)
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_user_activity_streaks_user_id
        ON user_activity_streaks (user_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_user_activity_streaks_last_active
        ON user_activity_streaks (last_active_date DESC);
    `);

    // ── peer_review_votes ───────────────────────────────────────────────────
    /* Tracks which users "liked" a peer review so the anti-gaming check can
       verify that a review received at least one liked vote before counting
       toward the reviewer's helpfulReviews score. */
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS peer_review_votes (
        id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        review_id  UUID        NOT NULL,
        voter_id   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_peer_review_votes UNIQUE (review_id, voter_id)
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_peer_review_votes_review_id
        ON peer_review_votes (review_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_peer_review_votes_voter_id
        ON peer_review_votes (voter_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS peer_review_votes;`);
    await queryRunner.query(`DROP TABLE IF EXISTS user_activity_streaks;`);
    await queryRunner.query(`DROP TABLE IF EXISTS leaderboard_snapshots;`);
  }
}
