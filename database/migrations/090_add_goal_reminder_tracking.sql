-- =============================================================================
-- Migration: 090_add_goal_reminder_tracking.sql
-- Description: Add deadline reminder tracking flags for learner goals
-- =============================================================================

ALTER TABLE learner_goals
ADD COLUMN IF NOT EXISTS reminder_sent_7d BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS reminder_sent_3d BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS reminder_sent_1d BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS overdue_notified BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_learner_goals_active_deadlines
  ON learner_goals(target_date ASC)
  WHERE status = 'active' AND target_date IS NOT NULL;

COMMENT ON COLUMN learner_goals.reminder_sent_7d IS 'Whether the 7-day deadline reminder has already been sent';
COMMENT ON COLUMN learner_goals.reminder_sent_3d IS 'Whether the 3-day deadline reminder has already been sent';
COMMENT ON COLUMN learner_goals.reminder_sent_1d IS 'Whether the 1-day deadline reminder has already been sent';
COMMENT ON COLUMN learner_goals.overdue_notified IS 'Whether the learner has already been notified that the goal is overdue';
