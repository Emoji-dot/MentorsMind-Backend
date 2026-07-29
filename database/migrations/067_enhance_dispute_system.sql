-- =============================================================================
-- Migration: 067_enhance_dispute_system.sql
-- Description: Overhaul disputes table to fix transaction_id bug and add new fields
-- =============================================================================

-- Step 1: Drop the existing foreign key (must be its own ALTER TABLE)
ALTER TABLE disputes
  DROP CONSTRAINT IF EXISTS disputes_transaction_id_fkey;

-- Step 2: Rename transaction_id -> session_id (idempotent via DO block)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'disputes' AND column_name = 'transaction_id'
  ) THEN
    ALTER TABLE disputes RENAME COLUMN transaction_id TO session_id;
  END IF;
END $$;

-- Step 3: Add FK from session_id -> bookings(id) if not yet present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'disputes' AND constraint_name = 'disputes_session_id_fkey'
  ) THEN
    ALTER TABLE disputes
      ADD CONSTRAINT disputes_session_id_fkey FOREIGN KEY (session_id) REFERENCES bookings(id);
  END IF;
END $$;

-- Step 4: Rename reporter_id -> filed_by_id (idempotent)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'disputes' AND column_name = 'reporter_id'
  ) THEN
    ALTER TABLE disputes RENAME COLUMN reporter_id TO filed_by_id;
  END IF;
END $$;

-- Step 5: Add new columns (IF NOT EXISTS guards via DO block)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'disputes' AND column_name = 'respondent_id'
  ) THEN
    ALTER TABLE disputes ADD COLUMN respondent_id UUID REFERENCES users(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'disputes' AND column_name = 'type'
  ) THEN
    ALTER TABLE disputes ADD COLUMN type VARCHAR(50) DEFAULT 'quality';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'disputes' AND column_name = 'resolved_at'
  ) THEN
    ALTER TABLE disputes ADD COLUMN resolved_at TIMESTAMP WITH TIME ZONE;
  END IF;
END $$;

-- Step 6: Migrate any legacy status values
UPDATE disputes SET status = 'investigating' WHERE status = 'under_review';

-- Step 7: Create indexes
CREATE INDEX IF NOT EXISTS idx_disputes_respondent_id ON disputes(respondent_id);
CREATE INDEX IF NOT EXISTS idx_disputes_session_id ON disputes(session_id);

-- Step 8: Add comments
COMMENT ON COLUMN disputes.session_id IS 'References the bookings table (was previously named transaction_id)';
COMMENT ON COLUMN disputes.type IS 'Dispute type: payment, quality, conduct, cancellation';
