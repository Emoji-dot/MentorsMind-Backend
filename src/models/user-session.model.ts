import pool from '../config/database';

export type DeviceType = 'desktop' | 'mobile' | 'tablet' | 'bot' | 'unknown';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type AnomalySeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';
export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface UserSession {
  id: string;
  user_id: string;
  token_hash: string | null;
  device_name: string | null;
  ip_address: string | null;
  user_agent: string | null;
  last_active_at: Date;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  // Device fingerprint
  device_fingerprint: string | null;
  device_type: DeviceType | null;
  browser_name: string | null;
  browser_version: string | null;
  os_name: string | null;
  os_version: string | null;
  screen_resolution: string | null;
  color_depth: number | null;
  language: string | null;
  timezone: string | null;
  platform: string | null;
  is_mobile: boolean;
  is_tablet: boolean;
  is_desktop: boolean;
  // Geo
  geo_country: string | null;
  geo_region: string | null;
  geo_city: string | null;
  geo_latitude: number | null;
  geo_longitude: number | null;
  geo_tz: string | null;
  geo_network: string | null;
  is_vpn: boolean;
  is_proxy: boolean;
  is_tor: boolean;
  is_datacenter: boolean;
  // Risk / Anomaly
  anomaly_score: number;
  anomaly_flags: string[] | null;
  risk_level: RiskLevel;
  is_trusted: boolean;
  challenge_passed: boolean | null;
  first_seen_ip: string | null;
  first_seen_ua: string | null;
}

export interface SessionAnomaly {
  id: string;
  user_id: string;
  session_id: string | null;
  type: string;
  severity: AnomalySeverity;
  score: number;
  description: string | null;
  details: Record<string, any> | null;
  resolved_at: Date | null;
  created_at: Date;
}

export interface SessionAlert {
  id: string;
  user_id: string;
  session_id: string | null;
  anomaly_id: string | null;
  alert_type: string;
  severity: AlertSeverity;
  message: string;
  metadata: Record<string, any> | null;
  delivered_via: string[] | null;
  read_at: Date | null;
  created_at: Date;
}

export interface TrustedDevice {
  id: string;
  user_id: string;
  device_fingerprint: string;
  nickname: string | null;
  first_seen_at: Date;
  last_seen_at: Date;
  trust_expires_at: Date | null;
  geo_country_at_trust: string | null;
  created_at: Date;
}

export interface DeviceInfo {
  device_type: DeviceType;
  browser_name: string | null;
  browser_version: string | null;
  os_name: string | null;
  os_version: string | null;
  platform: string | null;
  is_mobile: boolean;
  is_tablet: boolean;
  is_desktop: boolean;
}

export interface FingerprintComponents {
  user_agent: string | null;
  accept_language: string | null;
  accept_encoding: string | null;
  platform: string | null;
  screen_resolution: string | null;
  color_depth: number | null;
  timezone: string | null;
  language: string | null;
  client_hints?: Record<string, string>;
}

export const UserSessionModel = {
  // ── Session Queries ────────────────────────────────────────────────────

  async countActiveSessions(userId: string): Promise<number> {
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM user_sessions
       WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
      [userId],
    );
    return parseInt(rows[0].count, 10);
  },

  async getActiveSessions(userId: string): Promise<UserSession[]> {
    const { rows } = await pool.query<UserSession>(
      `SELECT * FROM user_sessions
       WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
       ORDER BY last_active_at DESC`,
      [userId],
    );
    return rows;
  },

  async findById(sessionId: string): Promise<UserSession | null> {
    const { rows } = await pool.query<UserSession>(
      `SELECT * FROM user_sessions WHERE id = $1`,
      [sessionId],
    );
    return rows[0] ?? null;
  },

  async findByTokenHash(tokenHash: string): Promise<UserSession | null> {
    const { rows } = await pool.query<UserSession>(
      `SELECT * FROM user_sessions
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
      [tokenHash],
    );
    return rows[0] ?? null;
  },

  async getRecentSessionsByFingerprint(userId: string, fingerprint: string, hours: number = 720): Promise<UserSession[]> {
    const { rows } = await pool.query<UserSession>(
      `SELECT * FROM user_sessions
       WHERE user_id = $1 AND device_fingerprint = $2 AND created_at > NOW() - ($3 * INTERVAL '1 hour')
       ORDER BY created_at DESC`,
      [userId, fingerprint, hours],
    );
    return rows;
  },

  async getRecentCountries(userId: string, days: number = 90): Promise<string[]> {
    const { rows } = await pool.query<{ geo_country: string }>(
      `SELECT DISTINCT geo_country FROM user_sessions
       WHERE user_id = $1 AND geo_country IS NOT NULL AND created_at > NOW() - ($2 * INTERVAL '1 day')`,
      [userId, days],
    );
    return rows.map((r) => r.geo_country).filter(Boolean);
  },

  async getLastSessionGeo(userId: string): Promise<{ lat: number | null; lon: number | null; country: string | null; at: Date | null }> {
    const { rows } = await pool.query<UserSession>(
      `SELECT geo_latitude, geo_longitude, geo_country, created_at FROM user_sessions
       WHERE user_id = $1 AND geo_latitude IS NOT NULL AND revoked_at IS NULL
       ORDER BY created_at DESC
       LIMIT 2`,
      [userId],
    );
    const second = rows[1];
    return {
      lat: second?.geo_latitude ?? null,
      lon: second?.geo_longitude ?? null,
      country: second?.geo_country ?? null,
      at: second?.created_at ?? null,
    };
  },

  async updateSession(sessionId: string, patch: Partial<UserSession>): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;
    for (const key of Object.keys(patch) as (keyof UserSession)[]) {
      if (key === 'id' || key === 'user_id') continue;
      const val = patch[key];
      if (val === undefined) continue;
      fields.push(`${key} = $${idx++}`);
      values.push(val);
    }
    if (!fields.length) return;
    values.push(sessionId);
    await pool.query(
      `UPDATE user_sessions SET ${fields.join(', ')} WHERE id = $${idx}`,
      values,
    );
  },

  // ── Anomalies ──────────────────────────────────────────────────────────

  async createAnomaly(params: {
    userId: string;
    sessionId?: string;
    type: string;
    severity: AnomalySeverity;
    score: number;
    description?: string;
    details?: Record<string, any>;
  }): Promise<SessionAnomaly> {
    const { rows } = await pool.query<SessionAnomaly>(
      `INSERT INTO session_anomalies (user_id, session_id, type, severity, score, description, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        params.userId,
        params.sessionId ?? null,
        params.type,
        params.severity,
        params.score,
        params.description ?? null,
        params.details ? JSON.stringify(params.details) : null,
      ],
    );
    return rows[0];
  },

  async listAnomalies(userId: string, unresolvedOnly = false, limit = 50): Promise<SessionAnomaly[]> {
    const { rows } = await pool.query<SessionAnomaly>(
      `SELECT * FROM session_anomalies
       WHERE user_id = $1 ${unresolvedOnly ? 'AND resolved_at IS NULL' : ''}
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit],
    );
    return rows;
  },

  async resolveAnomaliesForSession(sessionId: string): Promise<number> {
    const { rowCount } = await pool.query(
      `UPDATE session_anomalies SET resolved_at = NOW() WHERE session_id = $1 AND resolved_at IS NULL`,
      [sessionId],
    );
    return rowCount ?? 0;
  },

  // ── Alerts ─────────────────────────────────────────────────────────────

  async createAlert(params: {
    userId: string;
    sessionId?: string;
    anomalyId?: string;
    alertType: string;
    severity: AlertSeverity;
    message: string;
    metadata?: Record<string, any>;
    deliveredVia?: string[];
  }): Promise<SessionAlert> {
    const { rows } = await pool.query<SessionAlert>(
      `INSERT INTO session_alerts (user_id, session_id, anomaly_id, alert_type, severity, message, metadata, delivered_via)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        params.userId,
        params.sessionId ?? null,
        params.anomalyId ?? null,
        params.alertType,
        params.severity,
        params.message,
        params.metadata ? JSON.stringify(params.metadata) : null,
        params.deliveredVia ?? null,
      ],
    );
    return rows[0];
  },

  async listAlerts(userId: string, unreadOnly = false, limit = 100): Promise<SessionAlert[]> {
    const { rows } = await pool.query<SessionAlert>(
      `SELECT * FROM session_alerts
       WHERE user_id = $1 ${unreadOnly ? 'AND read_at IS NULL' : ''}
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit],
    );
    return rows;
  },

  async markAlertRead(alertId: string, userId: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      `UPDATE session_alerts SET read_at = NOW() WHERE id = $1 AND user_id = $2`,
      [alertId, userId],
    );
    return (rowCount ?? 0) > 0;
  },

  async countUnreadAlerts(userId: string): Promise<number> {
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM session_alerts WHERE user_id = $1 AND read_at IS NULL`,
      [userId],
    );
    return parseInt(rows[0].count, 10);
  },

  // ── Trusted Devices ────────────────────────────────────────────────────

  async getTrustedDevices(userId: string): Promise<TrustedDevice[]> {
    const { rows } = await pool.query<TrustedDevice>(
      `SELECT * FROM trusted_devices WHERE user_id = $1
       AND (trust_expires_at IS NULL OR trust_expires_at > NOW())
       ORDER BY last_seen_at DESC`,
      [userId],
    );
    return rows;
  },

  async isTrustedDevice(userId: string, fingerprint: string): Promise<TrustedDevice | null> {
    const { rows } = await pool.query<TrustedDevice>(
      `SELECT * FROM trusted_devices
       WHERE user_id = $1 AND device_fingerprint = $2
       AND (trust_expires_at IS NULL OR trust_expires_at > NOW())`,
      [userId, fingerprint],
    );
    return rows[0] ?? null;
  },

  async markTrusted(params: {
    userId: string;
    fingerprint: string;
    nickname?: string;
    trustDays?: number;
    geoCountry?: string;
  }): Promise<TrustedDevice> {
    const expiresAt = params.trustDays
      ? new Date(Date.now() + params.trustDays * 24 * 60 * 60 * 1000)
      : null;
    const { rows } = await pool.query<TrustedDevice>(
      `INSERT INTO trusted_devices (user_id, device_fingerprint, nickname, trust_expires_at, geo_country_at_trust)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, device_fingerprint) DO UPDATE SET
         last_seen_at = NOW(),
         nickname = COALESCE(EXCLUDED.nickname, trusted_devices.nickname),
         trust_expires_at = COALESCE(EXCLUDED.trust_expires_at, trusted_devices.trust_expires_at)
       RETURNING *`,
      [
        params.userId,
        params.fingerprint,
        params.nickname ?? null,
        expiresAt,
        params.geoCountry ?? null,
      ],
    );
    return rows[0];
  },

  async untrustDevice(userId: string, trustedDeviceId: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      `DELETE FROM trusted_devices WHERE id = $1 AND user_id = $2`,
      [trustedDeviceId, userId],
    );
    return (rowCount ?? 0) > 0;
  },

  async touchTrustedDevice(userId: string, fingerprint: string): Promise<void> {
    await pool.query(
      `UPDATE trusted_devices SET last_seen_at = NOW()
       WHERE user_id = $1 AND device_fingerprint = $2`,
      [userId, fingerprint],
    );
  },
};
