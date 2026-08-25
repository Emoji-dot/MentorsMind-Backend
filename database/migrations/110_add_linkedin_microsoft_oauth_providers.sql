-- =============================================================================
-- Migration: 110_add_linkedin_microsoft_oauth_providers.sql
-- Description: Add 'linkedin' and 'microsoft' values to the oauth_provider ENUM
--              to support LinkedIn and Microsoft (Azure AD) OAuth2 social login.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'linkedin'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'oauth_provider')
  ) THEN
    ALTER TYPE oauth_provider ADD VALUE 'linkedin';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'microsoft'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'oauth_provider')
  ) THEN
    ALTER TYPE oauth_provider ADD VALUE 'microsoft';
  END IF;
END $$;
