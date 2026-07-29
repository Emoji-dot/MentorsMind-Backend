-- Migration: 091_create_admin_impersonation_sessions.sql
-- Creates the audit table that tracks every admin impersonation session.
-- Used by the admin impersonation feature (issue #750).

CREATE TABLE IF NOT EXISTS admin_impersonation_sessions (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason            TEXT        NOT NULL,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMPTZ NOT NULL,
  ended_at          TIMESTAMPTZ,
  ip_address        TEXT,
  user_agent        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast look-ups by admin (for listing active sessions)
CREATE INDEX IF NOT EXISTS idx_admin_impersonation_admin_id
  ON admin_impersonation_sessions (admin_id);

-- Fast look-ups by target (for auditing who has been impersonated)
CREATE INDEX IF NOT EXISTS idx_admin_impersonation_target_id
  ON admin_impersonation_sessions (target_user_id);

-- Efficient expiry / active-session queries
CREATE INDEX IF NOT EXISTS idx_admin_impersonation_expires_at
  ON admin_impersonation_sessions (expires_at)
  WHERE ended_at IS NULL;

COMMENT ON TABLE admin_impersonation_sessions IS
  'Audit trail for every admin impersonation session. Records must never be deleted.';
