-- Advanced session management: device fingerprint, geo IP, anomaly detection, concurrent session limits
-- and session security alerts infrastructure

-- ─── user_sessions extension ───────────────────────────────────────────────

ALTER TABLE user_sessions
  ADD COLUMN IF NOT EXISTS device_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS device_type VARCHAR(20) CHECK (device_type IN ('desktop', 'mobile', 'tablet', 'bot', 'unknown')),
  ADD COLUMN IF NOT EXISTS browser_name VARCHAR(50),
  ADD COLUMN IF NOT EXISTS browser_version VARCHAR(20),
  ADD COLUMN IF NOT EXISTS os_name VARCHAR(50),
  ADD COLUMN IF NOT EXISTS os_version VARCHAR(30),
  ADD COLUMN IF NOT EXISTS screen_resolution VARCHAR(20),
  ADD COLUMN IF NOT EXISTS color_depth INT,
  ADD COLUMN IF NOT EXISTS language VARCHAR(20),
  ADD COLUMN IF NOT EXISTS timezone VARCHAR(60),
  ADD COLUMN IF NOT EXISTS platform VARCHAR(50),
  ADD COLUMN IF NOT EXISTS is_mobile BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_tablet BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_desktop BOOLEAN DEFAULT FALSE;

ALTER TABLE user_sessions
  ADD COLUMN IF NOT EXISTS geo_country VARCHAR(2),
  ADD COLUMN IF NOT EXISTS geo_region VARCHAR(100),
  ADD COLUMN IF NOT EXISTS geo_city VARCHAR(100),
  ADD COLUMN IF NOT EXISTS geo_latitude DECIMAL(10, 6),
  ADD COLUMN IF NOT EXISTS geo_longitude DECIMAL(10, 6),
  ADD COLUMN IF NOT EXISTS geo_tz VARCHAR(60),
  ADD COLUMN IF NOT EXISTS geo_network VARCHAR(100), -- ISP/ASN
  ADD COLUMN IF NOT EXISTS is_vpn BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_proxy BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_tor BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_datacenter BOOLEAN DEFAULT FALSE;

ALTER TABLE user_sessions
  ADD COLUMN IF NOT EXISTS anomaly_score NUMERIC(5, 2) DEFAULT 0, -- 0-100
  ADD COLUMN IF NOT EXISTS anomaly_flags TEXT[], -- e.g., ['NEW_COUNTRY','RAPID_GEO_JUMP','UA_MISMATCH']
  ADD COLUMN IF NOT EXISTS risk_level VARCHAR(20) DEFAULT 'low' CHECK (risk_level IN ('low','medium','high','critical')),
  ADD COLUMN IF NOT EXISTS is_trusted BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS challenge_passed BOOLEAN, -- if step-up auth was required and completed
  ADD COLUMN IF NOT EXISTS first_seen_ip INET,
  ADD COLUMN IF NOT EXISTS first_seen_ua TEXT;

CREATE INDEX IF NOT EXISTS idx_user_sessions_fingerprint ON user_sessions(device_fingerprint)
  WHERE device_fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_sessions_geo_country ON user_sessions(user_id, geo_country);
CREATE INDEX IF NOT EXISTS idx_user_sessions_risk ON user_sessions(user_id, risk_level, revoked_at)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(user_id, revoked_at, expires_at);

-- ─── session_anomalies ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS session_anomalies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES user_sessions(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('info','low','medium','high','critical')),
  score NUMERIC(5, 2) NOT NULL,
  description TEXT,
  details JSONB,
  resolved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_anomalies_user ON session_anomalies(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_anomalies_session ON session_anomalies(session_id);
CREATE INDEX IF NOT EXISTS idx_session_anomalies_severity ON session_anomalies(severity, created_at DESC)
  WHERE resolved_at IS NULL;

-- ─── session_alerts ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS session_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES user_sessions(id) ON DELETE CASCADE,
  anomaly_id UUID REFERENCES session_anomalies(id) ON DELETE SET NULL,
  alert_type VARCHAR(50) NOT NULL, -- e.g., NEW_DEVICE, GEO_ANOMALY, SESSION_HIJACK, CONCURRENT_LIMIT
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('info','warning','critical')),
  message TEXT NOT NULL,
  metadata JSONB,
  delivered_via TEXT[], -- e.g., ['email','in_app']
  read_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_alerts_user_unread ON session_alerts(user_id, read_at)
  WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_session_alerts_session ON session_alerts(session_id);

-- ─── trusted_devices ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS trusted_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_fingerprint TEXT NOT NULL,
  nickname VARCHAR(100),
  first_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  trust_expires_at TIMESTAMP WITH TIME ZONE,
  geo_country_at_trust VARCHAR(2),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trusted_devices_unique
  ON trusted_devices(user_id, device_fingerprint);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_user ON trusted_devices(user_id);
