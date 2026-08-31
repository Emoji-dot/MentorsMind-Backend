-- =============================================================================
-- Migration: 106_add_tenant_id_and_rls.sql
-- Description: Add tenant_id columns to all tenant-scoped tables and enable
--              PostgreSQL Row Level Security (RLS) as a defense-in-depth layer.
--
-- Strategy
-- ────────
-- 1. Add a nullable tenant_id UUID column to each tenant-scoped table.
--    Nullable because existing rows have no tenant and single-tenant
--    deployments may not use the column at all.
-- 2. Add a foreign-key reference to tenants(id).
-- 3. Create a partial index for fast per-tenant lookups.
-- 4. Enable RLS on each table.
-- 5. Create TWO policies per table:
--      a. tenant_isolation  — filters rows by current_setting('app.tenant_id')
--      b. admin_bypass      — allows rows when app.tenant_id = '__ADMIN_BYPASS__'
--         or when the setting is not set / empty (system / background jobs).
--
-- The app.tenant_id session variable is set on every connection checkout from
-- the pg pool (see src/config/database.ts TenantPoolManager).
--
-- Note on existing rows
-- ─────────────────────
-- Rows created before this migration have tenant_id = NULL. The RLS policy
-- includes `OR tenant_id IS NULL` so they remain accessible during the
-- migration window. After backfilling tenant_id on all existing rows, you
-- should remove that exception in a follow-up migration.
-- =============================================================================

-- ─── Helper: create app.tenant_id setting if missing ─────────────────────────
-- This prevents errors when the setting has never been set in a session.
ALTER DATABASE CURRENT SET "app.tenant_id" = '';

-- =============================================================================
-- TABLE: users
-- =============================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users(tenant_id)
  WHERE tenant_id IS NOT NULL;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

-- Allow rows for the current tenant, rows with no tenant, or admin bypass
DROP POLICY IF EXISTS tenant_isolation ON users;
CREATE POLICY tenant_isolation ON users
  USING (
    tenant_id IS NULL
    OR tenant_id::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.tenant_id', TRUE) = '__ADMIN_BYPASS__'
    OR current_setting('app.tenant_id', TRUE) IS NULL
    OR current_setting('app.tenant_id', TRUE) = ''
  );

-- =============================================================================
-- TABLE: bookings
-- =============================================================================

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_bookings_tenant_id ON bookings(tenant_id)
  WHERE tenant_id IS NOT NULL;

ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON bookings;
CREATE POLICY tenant_isolation ON bookings
  USING (
    tenant_id IS NULL
    OR tenant_id::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.tenant_id', TRUE) = '__ADMIN_BYPASS__'
    OR current_setting('app.tenant_id', TRUE) IS NULL
    OR current_setting('app.tenant_id', TRUE) = ''
  );

-- =============================================================================
-- TABLE: sessions
-- =============================================================================

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_sessions_tenant_id ON sessions(tenant_id)
  WHERE tenant_id IS NOT NULL;

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON sessions;
CREATE POLICY tenant_isolation ON sessions
  USING (
    tenant_id IS NULL
    OR tenant_id::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.tenant_id', TRUE) = '__ADMIN_BYPASS__'
    OR current_setting('app.tenant_id', TRUE) IS NULL
    OR current_setting('app.tenant_id', TRUE) = ''
  );

-- =============================================================================
-- TABLE: transactions
-- =============================================================================

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_transactions_tenant_id ON transactions(tenant_id)
  WHERE tenant_id IS NOT NULL;

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON transactions;
CREATE POLICY tenant_isolation ON transactions
  USING (
    tenant_id IS NULL
    OR tenant_id::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.tenant_id', TRUE) = '__ADMIN_BYPASS__'
    OR current_setting('app.tenant_id', TRUE) IS NULL
    OR current_setting('app.tenant_id', TRUE) = ''
  );

-- =============================================================================
-- TABLE: wallets
-- =============================================================================

ALTER TABLE wallets
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_wallets_tenant_id ON wallets(tenant_id)
  WHERE tenant_id IS NOT NULL;

ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON wallets;
CREATE POLICY tenant_isolation ON wallets
  USING (
    tenant_id IS NULL
    OR tenant_id::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.tenant_id', TRUE) = '__ADMIN_BYPASS__'
    OR current_setting('app.tenant_id', TRUE) IS NULL
    OR current_setting('app.tenant_id', TRUE) = ''
  );

-- =============================================================================
-- TABLE: disputes
-- =============================================================================

ALTER TABLE disputes
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_disputes_tenant_id ON disputes(tenant_id)
  WHERE tenant_id IS NOT NULL;

ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE disputes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON disputes;
CREATE POLICY tenant_isolation ON disputes
  USING (
    tenant_id IS NULL
    OR tenant_id::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.tenant_id', TRUE) = '__ADMIN_BYPASS__'
    OR current_setting('app.tenant_id', TRUE) IS NULL
    OR current_setting('app.tenant_id', TRUE) = ''
  );

-- =============================================================================
-- TABLE: notifications
-- =============================================================================

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_notifications_tenant_id ON notifications(tenant_id)
  WHERE tenant_id IS NOT NULL;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON notifications;
CREATE POLICY tenant_isolation ON notifications
  USING (
    tenant_id IS NULL
    OR tenant_id::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.tenant_id', TRUE) = '__ADMIN_BYPASS__'
    OR current_setting('app.tenant_id', TRUE) IS NULL
    OR current_setting('app.tenant_id', TRUE) = ''
  );

-- =============================================================================
-- TABLE: reviews
-- =============================================================================

ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_reviews_tenant_id ON reviews(tenant_id)
  WHERE tenant_id IS NOT NULL;

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON reviews;
CREATE POLICY tenant_isolation ON reviews
  USING (
    tenant_id IS NULL
    OR tenant_id::text = current_setting('app.tenant_id', TRUE)
    OR current_setting('app.tenant_id', TRUE) = '__ADMIN_BYPASS__'
    OR current_setting('app.tenant_id', TRUE) IS NULL
    OR current_setting('app.tenant_id', TRUE) = ''
  );

-- =============================================================================
-- GRANT: Ensure the application user can use the setting
-- =============================================================================
-- The database user running the application needs SUPERUSER or the ability
-- to call set_config. Grant it explicitly if you use a restricted role:
--
--   GRANT pg_read_all_settings TO app_user;
--
-- For most setups, this is not needed as set_config is available to all roles.

-- =============================================================================
-- Comments
-- =============================================================================
COMMENT ON COLUMN users.tenant_id       IS 'Multi-tenant isolation: owning tenant UUID (NULL = shared/legacy row)';
COMMENT ON COLUMN bookings.tenant_id    IS 'Multi-tenant isolation: owning tenant UUID (NULL = shared/legacy row)';
COMMENT ON COLUMN sessions.tenant_id    IS 'Multi-tenant isolation: owning tenant UUID (NULL = shared/legacy row)';
COMMENT ON COLUMN transactions.tenant_id IS 'Multi-tenant isolation: owning tenant UUID (NULL = shared/legacy row)';
COMMENT ON COLUMN wallets.tenant_id     IS 'Multi-tenant isolation: owning tenant UUID (NULL = shared/legacy row)';
COMMENT ON COLUMN disputes.tenant_id    IS 'Multi-tenant isolation: owning tenant UUID (NULL = shared/legacy row)';
COMMENT ON COLUMN notifications.tenant_id IS 'Multi-tenant isolation: owning tenant UUID (NULL = shared/legacy row)';
COMMENT ON COLUMN reviews.tenant_id     IS 'Multi-tenant isolation: owning tenant UUID (NULL = shared/legacy row)';
