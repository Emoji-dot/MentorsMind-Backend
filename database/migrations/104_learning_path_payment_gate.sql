-- Migration: add learning path purchase gate columns and purchase records
-- Issue #764.

ALTER TABLE learning_paths
  ADD COLUMN IF NOT EXISTS price NUMERIC(15, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_free BOOLEAN NOT NULL DEFAULT true;

UPDATE learning_paths
SET
  price = COALESCE(total_price, 0),
  is_free = COALESCE(total_price, 0) <= 0
WHERE price = 0
  AND COALESCE(total_price, 0) > 0;

ALTER TABLE path_enrollments
  ADD COLUMN IF NOT EXISTS is_trial BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS requires_payment_after TIMESTAMP WITH TIME ZONE;

CREATE TABLE IF NOT EXISTS learning_path_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learning_path_id UUID NOT NULL REFERENCES learning_paths(id) ON DELETE CASCADE,
  enrollment_id UUID NOT NULL REFERENCES path_enrollments(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  amount NUMERIC(15, 2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'XLM',
  provider VARCHAR(50) NOT NULL,
  payment_reference VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(enrollment_id),
  UNIQUE(transaction_id),
  UNIQUE(provider, payment_reference)
);

CREATE INDEX IF NOT EXISTS idx_learning_path_purchases_path
  ON learning_path_purchases(learning_path_id);

CREATE INDEX IF NOT EXISTS idx_learning_path_purchases_student
  ON learning_path_purchases(student_id);

CREATE INDEX IF NOT EXISTS idx_path_enrollments_trials
  ON path_enrollments(trial_ends_at)
  WHERE is_trial = true AND payment_status <> 'paid';

