-- =============================================================================
-- Migration: 083_create_verifiable_credentials.sql
-- Description: Create verifiable_credentials table for W3C VC issuance, anchoring, and revocation
-- =============================================================================

CREATE TABLE IF NOT EXISTS verifiable_credentials (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id     VARCHAR(255) NOT NULL UNIQUE,
  issuer_did        VARCHAR(255) NOT NULL,
  subject_did       VARCHAR(255) NOT NULL,
  credential_type   VARCHAR(100) NOT NULL,
  credential_data   JSONB NOT NULL,
  proof_jws         TEXT NOT NULL,
  kid               VARCHAR(255) NOT NULL,
  stellar_tx_hash   VARCHAR(128),
  stellar_ledger    BIGINT,
  revoked           BOOLEAN NOT NULL DEFAULT FALSE,
  revoked_at        TIMESTAMPTZ,
  revoked_reason    TEXT,
  issued_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_vc_credential_id ON verifiable_credentials (credential_id);
CREATE INDEX idx_vc_subject_did ON verifiable_credentials (subject_did);
CREATE INDEX idx_vc_issuer_did ON verifiable_credentials (issuer_did);
CREATE INDEX idx_vc_type ON verifiable_credentials (credential_type);
CREATE INDEX idx_vc_revoked ON verifiable_credentials (revoked) WHERE revoked = TRUE;

COMMENT ON TABLE verifiable_credentials IS 'W3C Verifiable Credentials issued by the platform';
COMMENT ON COLUMN verifiable_credentials.credential_id IS 'Unique credential identifier (urn:uuid:...)';
COMMENT ON COLUMN verifiable_credentials.stellar_tx_hash IS 'Stellar transaction hash anchoring the credential hash';
COMMENT ON COLUMN verifiable_credentials.revoked IS 'Whether the credential has been revoked';
