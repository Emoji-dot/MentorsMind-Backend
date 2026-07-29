-- Migration 089: Add iCal security fields
-- Adds security fields for rate limiting, expiry, and access tracking of iCal feeds

ALTER TABLE users
ADD COLUMN IF NOT EXISTS ical_token_expires_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_ical_access_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS ical_access_count INTEGER NOT NULL DEFAULT 0;
