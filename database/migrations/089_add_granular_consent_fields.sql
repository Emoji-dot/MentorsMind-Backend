-- =============================================================================
-- Migration: 089_add_granular_consent_fields.sql
-- Description: Add granular GDPR consent fields to consent_records table.
--              GDPR Article 7 requires separately granular, freely-given consent
--              for each distinct data processing purpose.
-- =============================================================================

-- Add session_recording_consent column
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'consent_records' AND column_name = 'session_recording_consent'
    ) THEN
        ALTER TABLE consent_records ADD COLUMN session_recording_consent BOOLEAN NOT NULL DEFAULT FALSE;
    END IF;
END $$;

-- Add ai_analysis_consent column
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'consent_records' AND column_name = 'ai_analysis_consent'
    ) THEN
        ALTER TABLE consent_records ADD COLUMN ai_analysis_consent BOOLEAN NOT NULL DEFAULT FALSE;
    END IF;
END $$;

-- Add data_sharing_consent column
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'consent_records' AND column_name = 'data_sharing_consent'
    ) THEN
        ALTER TABLE consent_records ADD COLUMN data_sharing_consent BOOLEAN NOT NULL DEFAULT FALSE;
    END IF;
END $$;

-- Add consent_version to track which version of the consent policy was accepted
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'consent_records' AND column_name = 'consent_version'
    ) THEN
        ALTER TABLE consent_records ADD COLUMN consent_version VARCHAR(20) NOT NULL DEFAULT '1.0';
    END IF;
END $$;

-- Add withdrawn_at for consent withdrawal timestamp
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'consent_records' AND column_name = 'withdrawn_at'
    ) THEN
        ALTER TABLE consent_records ADD COLUMN withdrawn_at TIMESTAMP WITH TIME ZONE;
    END IF;
END $$;

-- Add withdrawal_reason for GDPR audit trail
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'consent_records' AND column_name = 'withdrawal_reason'
    ) THEN
        ALTER TABLE consent_records ADD COLUMN withdrawal_reason TEXT;
    END IF;
END $$;

-- Add index for withdrawal queries
CREATE INDEX IF NOT EXISTS idx_consent_records_withdrawn_at 
    ON consent_records(withdrawn_at) 
    WHERE withdrawn_at IS NOT NULL;

-- Add index for consent version tracking
CREATE INDEX IF NOT EXISTS idx_consent_records_version
    ON consent_records(consent_version);

-- Comments for new columns
COMMENT ON COLUMN consent_records.session_recording_consent IS 'Consent for session recording — required for video/audio recording (GDPR Article 7)';
COMMENT ON COLUMN consent_records.ai_analysis_consent IS 'Consent for AI analysis of session content — required for session summaries and coaching insights (GDPR Article 7)';
COMMENT ON COLUMN consent_records.data_sharing_consent IS 'Consent for sharing anonymised data with third parties (GDPR Article 7)';
COMMENT ON COLUMN consent_records.consent_version IS 'Version of the consent policy accepted (e.g. "1.0", "2.0") for tracking policy changes';
COMMENT ON COLUMN consent_records.withdrawn_at IS 'Timestamp when this consent record was withdrawn by the user';
COMMENT ON COLUMN consent_records.withdrawal_reason IS 'Optional reason given by the user for withdrawing consent';
