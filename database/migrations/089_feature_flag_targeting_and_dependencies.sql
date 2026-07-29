-- =============================================================================
-- Migration: 089_feature_flag_targeting_and_dependencies.sql
-- Description: Adds role/tier targeting and flag-dependency support to feature_flags
-- =============================================================================

-- targeting JSONB gains optional userTiers/roles keys (read/written by the
-- service layer — no schema change needed since targeting is already JSONB).
COMMENT ON COLUMN feature_flags.targeting IS 'targeting shape: { userIds?: string[], userSegments?: string[], tenants?: string[], userTiers?: string[], roles?: string[] }';

ALTER TABLE feature_flags ADD COLUMN IF NOT EXISTS depends_on_key VARCHAR(255) REFERENCES feature_flags(key) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_feature_flags_depends_on_key ON feature_flags(depends_on_key);

COMMENT ON COLUMN feature_flags.depends_on_key IS 'Optional dependency: this flag only evaluates true if the referenced flag is also enabled for the user';
