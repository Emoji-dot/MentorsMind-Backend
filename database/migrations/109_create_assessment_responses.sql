-- Migration 109: Create assessment_responses table for per-question IRT data.
--
-- Stores every individual question response so the IRT model can be calibrated
-- over time and adaptive sessions can be resumed.

CREATE TABLE IF NOT EXISTS assessment_responses (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID        NOT NULL,
  assessment_id         UUID        NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  question_id           TEXT        NOT NULL,
  selected_option       INTEGER     NOT NULL,
  is_correct            BOOLEAN     NOT NULL,
  -- IRT β value at the time of response (snapshot; questions can be re-calibrated)
  difficulty_parameter  DOUBLE PRECISION NOT NULL DEFAULT 0,
  -- θ estimate immediately after this response (NULL for non-adaptive)
  ability_estimate_after DOUBLE PRECISION,
  answered_at           TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_assessment_responses_user_assessment
  ON assessment_responses(user_id, assessment_id);

CREATE INDEX IF NOT EXISTS idx_assessment_responses_question
  ON assessment_responses(question_id);

CREATE INDEX IF NOT EXISTS idx_assessment_responses_answered_at
  ON assessment_responses(answered_at);

COMMENT ON TABLE assessment_responses IS
  'Per-question response log used for IRT model calibration and adaptive session state.';
