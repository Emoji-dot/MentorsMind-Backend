-- Migration 108: Add IRT difficulty_parameter to questions JSONB schema
-- and ability_estimate to assessment_results.
--
-- The difficulty_parameter (β) is stored inside each question object in the
-- assessments.questions JSONB column.  No ALTER COLUMN is needed for that;
-- the application layer reads/writes it directly.
--
-- We DO need a new column on assessment_results to persist the final θ.

ALTER TABLE assessment_results
  ADD COLUMN IF NOT EXISTS ability_estimate DOUBLE PRECISION;

COMMENT ON COLUMN assessment_results.ability_estimate IS
  'IRT ability estimate θ (Rasch model) at session completion. NULL for non-adaptive assessments.';

-- Back-fill NULL for all existing rows (no-op; column defaults to NULL).
