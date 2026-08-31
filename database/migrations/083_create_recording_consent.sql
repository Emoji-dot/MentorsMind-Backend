-- =============================================================================
-- Migration: 083_create_recording_consent.sql
-- Description: Create recording_consent table for explicit per-session consent
--              tracking. Both mentor and mentee must consent before a recording
--              can start. Revoking consent after recording begins stops it.
--
-- GDPR / privacy compliance note:
--   This table is the authoritative record of consent. It is separate from the
--   legacy mentor_consent / mentee_consent columns in session_recordings so that
--   consent decisions can be captured independently of the recording lifecycle.
-- =============================================================================

CREATE TABLE IF NOT EXISTS recording_consent (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Which session this consent record belongs to
    session_id          UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,

    -- The user who provided or revoked consent
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Role the user held in this session ('mentor' | 'mentee')
    user_role           VARCHAR(20) NOT NULL CHECK (user_role IN ('mentor', 'mentee')),

    -- Whether consent is currently granted
    consented           BOOLEAN NOT NULL DEFAULT FALSE,

    -- Timestamps for GDPR audit trail
    consented_at        TIMESTAMP WITH TIME ZONE,
    revoked_at          TIMESTAMP WITH TIME ZONE,

    -- Network metadata captured at time of consent (GDPR Art. 7 / CCPA)
    consent_ip_address  VARCHAR(45),
    consent_user_agent  TEXT,

    -- Free-text note (e.g. platform version, consent UI version)
    notes               TEXT,

    -- Standard audit fields
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,

    -- A user may only have one active consent record per session
    CONSTRAINT uq_recording_consent_session_user UNIQUE (session_id, user_id)
);

-- Index: look up consent by session (most common query)
CREATE INDEX idx_recording_consent_session_id
    ON recording_consent(session_id);

-- Index: look up consent by user (for user-facing "my consents" view)
CREATE INDEX idx_recording_consent_user_id
    ON recording_consent(user_id);

-- Index: filter sessions where both parties have consented
CREATE INDEX idx_recording_consent_consented
    ON recording_consent(session_id, consented);

-- Trigger: keep updated_at current
CREATE OR REPLACE FUNCTION update_recording_consent_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_recording_consent_updated_at
    BEFORE UPDATE ON recording_consent
    FOR EACH ROW
    EXECUTE FUNCTION update_recording_consent_updated_at();

-- Documentation
COMMENT ON TABLE recording_consent IS
    'Tracks explicit, revocable consent for session recordings. Both mentor and '
    'mentee must hold a consented=TRUE row before a recording may start. '
    'Revoking consent (consented=FALSE) must stop any active recording.';

COMMENT ON COLUMN recording_consent.user_role IS
    'Role of the user in this session: mentor or mentee.';
COMMENT ON COLUMN recording_consent.consented IS
    'Current consent state. FALSE means consent has not been given or was revoked.';
COMMENT ON COLUMN recording_consent.consented_at IS
    'Timestamp when consent was last granted. NULL if never consented.';
COMMENT ON COLUMN recording_consent.revoked_at IS
    'Timestamp when consent was last revoked. NULL if never revoked.';
COMMENT ON COLUMN recording_consent.consent_ip_address IS
    'Client IP address at the time of the consent action (GDPR audit trail).';
COMMENT ON COLUMN recording_consent.consent_user_agent IS
    'HTTP User-Agent at the time of the consent action (GDPR audit trail).';
