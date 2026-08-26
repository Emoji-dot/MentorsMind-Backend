-- MFA Devices table for WebAuthn/FIDO2 and multi-method MFA tracking
CREATE TABLE IF NOT EXISTS mfa_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL CHECK (type IN ('totp', 'sms', 'email', 'webauthn')),
    name VARCHAR(100),
    -- WebAuthn/FIDO2 fields
    credential_id BYTEA,
    credential_public_key BYTEA,
    credential_transports TEXT[],
    authenticator_attachment VARCHAR(20) CHECK (authenticator_attachment IN ('platform', 'cross-platform')),
    aaguid UUID,
    sign_count BIGINT DEFAULT 0,
    -- SMS/Email fields
    phone_number VARCHAR(30),
    email_address VARCHAR(255),
    -- TOTP fields (encrypted)
    encrypted_secret TEXT,
    -- Backup codes per device (optional)
    backup_codes_hashed TEXT[],
    -- Status fields
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mfa_devices_user_id ON mfa_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_mfa_devices_user_type ON mfa_devices(user_id, type, is_active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mfa_devices_credential_id ON mfa_devices(credential_id) WHERE credential_id IS NOT NULL;

-- MFA challenge store for registration/authentication ceremonies
CREATE TABLE IF NOT EXISTS mfa_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    challenge TEXT NOT NULL,
    type VARCHAR(30) NOT NULL CHECK (type IN ('webauthn_register', 'webauthn_authenticate', 'sms', 'email')),
    payload JSONB,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mfa_challenges_user_type ON mfa_challenges(user_id, type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mfa_challenges_expires_at ON mfa_challenges(expires_at);

-- Function to auto-update updated_at
CREATE OR REPLACE FUNCTION update_mfa_devices_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mfa_devices_updated_at ON mfa_devices;
CREATE TRIGGER trg_mfa_devices_updated_at
BEFORE UPDATE ON mfa_devices
FOR EACH ROW
EXECUTE FUNCTION update_mfa_devices_updated_at();
