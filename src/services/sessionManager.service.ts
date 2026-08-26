import crypto from 'crypto';
import { Request } from 'express';
import pool from '../config/database';
import { logger } from '../utils/logger.utils';
import { EmailService } from './email.service';
import { PaginationUtil } from '../utils/pagination.utils';
import { DeviceFingerprintService, GeoLookupResult } from './device-fingerprint.service';
import {
  UserSessionModel,
  UserSession,
  RiskLevel,
  AnomalySeverity,
  AlertSeverity,
  TrustedDevice,
} from '../models/user-session.model';
import { env } from '../config/env';
import { AuditLogService, extractIpAddress } from './auditLog.service';

const SESSION_EXPIRY_DAYS = 30;

export interface UserSessionCompact {
  id: string;
  user_id: string;
  device_name: string | null;
  ip_address: string | null;
  user_agent: string | null;
  last_active_at: Date;
  created_at: Date;
  expires_at: Date;
  device_type: UserSession['device_type'];
  is_mobile: boolean;
  is_tablet: boolean;
  is_desktop: boolean;
  browser_name: string | null;
  os_name: string | null;
  geo_country: string | null;
  geo_city: string | null;
  risk_level: RiskLevel;
  is_trusted: boolean;
  anomaly_score: number;
}

export interface CreateSessionResult {
  session: UserSession;
  riskLevel: RiskLevel;
  anomalyScore: number;
  flags: string[];
  concurrentLimitHit: boolean;
  revokedOldSessionId?: string;
}

export interface SessionDashboard {
  active: UserSessionCompact[];
  totalActive: number;
  concurrentLimit: number;
  trustedDevices: TrustedDevice[];
  alerts: any[];
  recentAnomalies: any[];
  unreadAlerts: number;
  countryHistory: string[];
}

export function parseDeviceName(userAgent: string | null | undefined): string {
  if (!userAgent) return 'Unknown Device';
  let os = 'Unknown OS';
  if (/Windows NT 10/.test(userAgent)) os = 'Windows 10';
  else if (/Windows NT 6\.3/.test(userAgent)) os = 'Windows 8.1';
  else if (/Windows NT 6\.1/.test(userAgent)) os = 'Windows 7';
  else if (/Windows/.test(userAgent)) os = 'Windows';
  else if (/iPhone/.test(userAgent)) os = 'iPhone';
  else if (/iPad/.test(userAgent)) os = 'iPad';
  else if (/Android/.test(userAgent)) os = 'Android';
  else if (/Mac OS X/.test(userAgent)) os = 'macOS';
  else if (/Linux/.test(userAgent)) os = 'Linux';
  let browser = 'Unknown Browser';
  if (/Edg\//.test(userAgent)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(userAgent)) browser = 'Opera';
  else if (/Chrome\//.test(userAgent)) browser = 'Chrome';
  else if (/Firefox\//.test(userAgent)) browser = 'Firefox';
  else if (/Safari\//.test(userAgent) && !/Chrome/.test(userAgent)) browser = 'Safari';
  else if (/MSIE|Trident/.test(userAgent)) browser = 'Internet Explorer';
  return `${browser} on ${os}`;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function getConcurrentLimit(): number {
  const n = parseInt(env.SESSION_MAX_CONCURRENT || '0', 10);
  return n > 0 ? n : 0; // 0 = unlimited
}

function scoreToLevel(score: number): RiskLevel {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}

// ─── Service ───────────────────────────────────────────────────────────────

export const SessionManagerService = {
  // ── Create / Login ────────────────────────────────────────────────────

  /**
   * Create a new session on login with:
   *   - device fingerprinting + stored parsed info
   *   - geo IP lookup
   *   - anomaly scoring
   *   - concurrent session limits
   *   - anomaly/alert creation + email alerting
   */
  async createSession(params: {
    userId: string;
    refreshToken: string;
    ipAddress: string | null;
    userAgent: string | null;
    userEmail: string;
    req?: Request;
  }): Promise<CreateSessionResult> {
    const { userId, refreshToken, ipAddress, userAgent, userEmail, req } = params;
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const deviceName = parseDeviceName(userAgent);
    const expiresAt = new Date(Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    // Fingerprinting
    const components = req ? DeviceFingerprintService.extractComponents(req) : { user_agent: userAgent } as any;
    const fingerprint = req
      ? DeviceFingerprintService.generate(req, components)
      : crypto.createHash('sha256').update(`${userId}|${userAgent}|${ipAddress}`).digest('hex');
    const deviceInfo = DeviceFingerprintService.parseDeviceInfo(
      Object.assign({}, { headers: { 'user-agent': userAgent } }) as any,
    );
    const geo: GeoLookupResult = ipAddress
      ? await DeviceFingerprintService.lookupGeo(ipAddress)
      : { country: null, region: null, city: null, latitude: null, longitude: null, timezone: null, network: null, is_vpn: false, is_proxy: false, is_tor: false, is_datacenter: false };

    // Concurrent session limits
    const limit = getConcurrentLimit();
    let concurrentLimitHit = false;
    let revokedOldSessionId: string | undefined;
    if (limit > 0) {
      const active = await UserSessionModel.countActiveSessions(userId);
      if (active >= limit) {
        concurrentLimitHit = true;
        // Revoke the least-recently-active session
        const oldest = await pool.query<UserSession>(
          `SELECT id FROM user_sessions
           WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
           ORDER BY last_active_at ASC LIMIT 1`,
          [userId],
        );
        if (oldest.rows.length) {
          revokedOldSessionId = oldest.rows[0].id;
          await pool.query(
            `UPDATE user_sessions SET revoked_at = NOW() WHERE id = $1`,
            [revokedOldSessionId],
          );
          await UserSessionModel.createAlert({
            userId,
            sessionId: revokedOldSessionId,
            alertType: 'CONCURRENT_LIMIT',
            severity: 'warning',
            message: 'Your oldest session was terminated due to the concurrent session limit.',
            metadata: { concurrentLimit: limit },
            deliveredVia: ['in_app'],
          });
        }
      }
    }

    // Anomaly scoring
    const flags: string[] = [];
    let score = 0;

    const trusted = await UserSessionModel.isTrustedDevice(userId, fingerprint);
    if (!trusted) {
      const prior = await UserSessionModel.getRecentSessionsByFingerprint(userId, fingerprint);
      if (!prior.length) {
        flags.push('NEW_DEVICE_FINGERPRINT');
        score += 25;
      }
    }

    const knownCountries = await UserSessionModel.getRecentCountries(userId, 90);
    if (geo.country && knownCountries.length > 0 && !knownCountries.includes(geo.country)) {
      flags.push('NEW_COUNTRY');
      score += 30;
    }

    const priorGeo = await UserSessionModel.getLastSessionGeo(userId);
    if (
      geo.latitude != null &&
      geo.longitude != null &&
      priorGeo.lat != null &&
      priorGeo.lon != null &&
      priorGeo.at
    ) {
      const hoursDelta = Math.max(0.1, (Date.now() - priorGeo.at.getTime()) / 3600_000);
      const travel = DeviceFingerprintService.detectImpossibleTravel({
        lat1: priorGeo.lat,
        lon1: priorGeo.lon,
        lat2: geo.latitude,
        lon2: geo.longitude,
        hoursDelta,
      });
      if (travel.impossible) {
        flags.push('RAPID_GEO_JUMP');
        score += 40;
      }
    }

    if (geo.is_vpn) { flags.push('VPN_DETECTED'); score += 10; }
    if (geo.is_proxy) { flags.push('PROXY_DETECTED'); score += 15; }
    if (geo.is_tor) { flags.push('TOR_DETECTED'); score += 45; }
    if (geo.is_datacenter) { flags.push('DATACENTER_DETECTED'); score += 15; }
    if (deviceInfo.device_type === 'bot') { flags.push('BOT_UA'); score += 40; }

    if (deviceInfo.is_mobile && knownCountries.length === 0) {
      // neutral, no score
    }

    const riskLevel = scoreToLevel(score);

    // Insert session
    const { rows } = await pool.query<UserSession>(
      `INSERT INTO user_sessions
         (user_id, token_hash, device_name, ip_address, user_agent, expires_at,
          device_fingerprint, device_type, browser_name, browser_version,
          os_name, os_version, platform, is_mobile, is_tablet, is_desktop,
          geo_country, geo_region, geo_city, geo_latitude, geo_longitude, geo_tz, geo_network,
          is_vpn, is_proxy, is_tor, is_datacenter,
          anomaly_score, anomaly_flags, risk_level, is_trusted,
          first_seen_ip, first_seen_ua)
       VALUES ($1,$2,$3,$4,$5,$6,
               $7,$8,$9,$10,
               $11,$12,$13,$14,$15,$16,
               $17,$18,$19,$20,$21,$22,$23,
               $24,$25,$26,$27,
               $28,$29,$30,$31,
               $32,$33)
       RETURNING *`,
      [
        userId, tokenHash, deviceName, ipAddress, userAgent, expiresAt,
        fingerprint, deviceInfo.device_type, deviceInfo.browser_name, deviceInfo.browser_version,
        deviceInfo.os_name, deviceInfo.os_version, deviceInfo.platform,
        deviceInfo.is_mobile, deviceInfo.is_tablet, deviceInfo.is_desktop,
        geo.country, geo.region, geo.city, geo.latitude, geo.longitude, geo.timezone, geo.network,
        geo.is_vpn, geo.is_proxy, geo.is_tor, geo.is_datacenter,
        score, flags.length ? flags : null, riskLevel, !!trusted,
        ipAddress, userAgent,
      ],
    );
    const session = rows[0];

    // Record anomalies + alerts
    if (flags.length || score >= 25) {
      const anomaly = await UserSessionModel.createAnomaly({
        userId,
        sessionId: session.id,
        type: 'SESSION_RISK_SCORE',
        severity:
          score >= 75 ? 'critical' : score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low',
        score,
        description: `Session risk score: ${score}/100. Flags: ${flags.join(', ') || 'none'}`,
        details: { flags, riskLevel, geoCountry: geo.country, isVpn: geo.is_vpn, isTor: geo.is_tor },
      });
      const alertSeverity: AlertSeverity =
        riskLevel === 'critical' || riskLevel === 'high' ? 'critical' : riskLevel === 'medium' ? 'warning' : 'info';
      await UserSessionModel.createAlert({
        userId,
        sessionId: session.id,
        anomalyId: anomaly.id,
        alertType: flags.includes('RAPID_GEO_JUMP') ? 'GEO_ANOMALY' : flags.includes('NEW_DEVICE_FINGERPRINT') ? 'NEW_DEVICE' : 'SESSION_RISK',
        severity: alertSeverity,
        message:
          flags.includes('RAPID_GEO_JUMP')
            ? 'Impossible travel detected between login locations.'
            : flags.includes('NEW_DEVICE_FINGERPRINT')
              ? 'A new device was used to log in to your account.'
              : `A login with elevated risk (${score}/100) was detected.`,
        metadata: { flags, riskLevel, score, country: geo.country, city: geo.city },
        deliveredVia: alertSeverity === 'info' ? ['in_app'] : ['in_app', 'email'],
      });
    }
    if (concurrentLimitHit) {
      await UserSessionModel.createAlert({
        userId,
        sessionId: session.id,
        alertType: 'CONCURRENT_LIMIT',
        severity: 'warning',
        message: `Concurrent session limit (${limit}) reached — oldest session terminated.`,
        metadata: { limit, revokedSessionId: revokedOldSessionId },
        deliveredVia: ['in_app'],
      });
    }

    // Touch trusted device
    if (trusted) {
      await UserSessionModel.touchTrustedDevice(userId, fingerprint);
    }

    // Audit log
    try {
      const ip = req ? extractIpAddress(req) : ipAddress;
      await AuditLogService.log({
        userId,
        action: 'SESSION_CREATED',
        resourceType: 'user_session',
        resourceId: session.id,
        ipAddress: ip,
        userAgent: userAgent,
        metadata: {
          riskLevel,
          anomalyScore: score,
          flags,
          concurrentLimitHit,
          country: geo.country,
          trusted: !!trusted,
        },
      });
    } catch (e) { /* audit must not break session */ }

    // Email alerts
    const needsEmail = score >= 25 || flags.includes('NEW_DEVICE_FINGERPRINT') || flags.includes('RAPID_GEO_JUMP');
    if (needsEmail || env.NODE_ENV !== 'production' || !trusted) {
      this.sendNewSessionAlert({
        userEmail,
        deviceName,
        ipAddress,
        createdAt: session.created_at,
        geoCountry: geo.country,
        geoCity: geo.city,
        riskLevel,
        anomalyScore: score,
        flags,
      }).catch((err) => logger.error('Failed to send new session alert email', { error: err.message }));
    }

    return {
      session,
      riskLevel,
      anomalyScore: score,
      flags,
      concurrentLimitHit,
      revokedOldSessionId,
    };
  },

  // ── Session list / dashboard ──────────────────────────────────────────

  async listSessions(userId: string, filters: { cursor?: string; limit?: number }): Promise<{ sessions: UserSession[]; next_cursor: string | null; has_more: boolean; total: number }> {
    const limit = filters.limit ?? 20;
    const conditions: string[] = ['user_id = $1', 'revoked_at IS NULL', 'expires_at > NOW()'];
    const params: unknown[] = [userId];
    let idx = 2;
    if (filters.cursor) {
      const decoded = PaginationUtil.decodeCursor(filters.cursor);
      if (decoded) {
        conditions.push(`(last_active_at, id) < ($${idx}, $${idx + 1})`);
        params.push(decoded.created_at, decoded.id);
        idx += 2;
      }
    }
    const [{ rows }, { rows: countRows }] = await Promise.all([
      pool.query<UserSession>(
        `SELECT * FROM user_sessions
         WHERE ${conditions.join(' AND ')}
         ORDER BY last_active_at DESC, id DESC
         LIMIT $${idx}`,
        [...params, limit + 1],
      ),
      pool.query(`SELECT COUNT(*) FROM user_sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()`, [userId]),
    ]);
    const has_more = rows.length > limit;
    const data = has_more ? rows.slice(0, limit) : rows;
    const lastItem = data[data.length - 1];
    const next_cursor = has_more && lastItem ? PaginationUtil.encodeCursor({ id: lastItem.id, created_at: lastItem.last_active_at.toISOString() }) : null;
    return {
      sessions: data,
      next_cursor,
      has_more,
      total: parseInt(countRows[0].count, 10),
    };
  },

  async getDashboard(userId: string): Promise<SessionDashboard> {
    const [
      activeSessions,
      trustedDevices,
      alerts,
      anomalies,
      unreadCount,
      countries,
    ] = await Promise.all([
      UserSessionModel.getActiveSessions(userId),
      UserSessionModel.getTrustedDevices(userId),
      UserSessionModel.listAlerts(userId, true, 20),
      UserSessionModel.listAnomalies(userId, true, 20),
      UserSessionModel.countUnreadAlerts(userId),
      UserSessionModel.getRecentCountries(userId, 90),
    ]);
    const compact: UserSessionCompact[] = activeSessions.map((s) => ({
      id: s.id,
      user_id: s.user_id,
      device_name: s.device_name,
      ip_address: s.ip_address,
      user_agent: s.user_agent,
      last_active_at: s.last_active_at,
      created_at: s.created_at,
      expires_at: s.expires_at,
      device_type: s.device_type,
      is_mobile: s.is_mobile,
      is_tablet: s.is_tablet,
      is_desktop: s.is_desktop,
      browser_name: s.browser_name,
      os_name: s.os_name,
      geo_country: s.geo_country,
      geo_city: s.geo_city,
      risk_level: s.risk_level,
      is_trusted: s.is_trusted,
      anomaly_score: s.anomaly_score,
    }));
    return {
      active: compact,
      totalActive: activeSessions.length,
      concurrentLimit: getConcurrentLimit(),
      trustedDevices,
      alerts,
      recentAnomalies: anomalies,
      unreadAlerts: unreadCount,
      countryHistory: countries,
    };
  },

  // ── Revocation / Termination ──────────────────────────────────────────

  async revokeSession(sessionId: string, userId: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      `UPDATE user_sessions SET revoked_at = NOW()
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [sessionId, userId],
    );
    return (rowCount ?? 0) > 0;
  },

  async revokeAllSessions(userId: string, currentRefreshToken: string): Promise<number> {
    const currentTokenHash = crypto.createHash('sha256').update(currentRefreshToken).digest('hex');
    const { rowCount } = await pool.query(
      `UPDATE user_sessions SET revoked_at = NOW()
       WHERE user_id = $1 AND token_hash != $2 AND revoked_at IS NULL`,
      [userId, currentTokenHash],
    );
    return rowCount ?? 0;
  },

  async revokeAllSessionsAbsolutely(userId: string): Promise<number> {
    const { rowCount } = await pool.query(
      `UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
    return rowCount ?? 0;
  },

  async revokeSessionsByFlag(userId: string, flags: string[]): Promise<number> {
    // Revoke any active session whose anomaly_flags intersect the given flags.
    const { rowCount } = await pool.query(
      `UPDATE user_sessions SET revoked_at = NOW()
       WHERE user_id = $1 AND revoked_at IS NULL
         AND anomaly_flags && $2::text[]`,
      [userId, flags],
    );
    return rowCount ?? 0;
  },

  async revokeSessionByToken(refreshToken: string): Promise<void> {
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    await pool.query(
      `UPDATE user_sessions SET revoked_at = NOW() WHERE token_hash = $1`,
      [tokenHash],
    );
  },

  // ── Touch / activity updates ──────────────────────────────────────────

  async touchSession(refreshToken: string): Promise<void> {
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    await pool.query(
      `UPDATE user_sessions SET last_active_at = NOW()
       WHERE token_hash = $1
         AND revoked_at IS NULL AND expires_at > NOW()
         AND last_active_at < NOW() - INTERVAL '1 minute'`,
      [tokenHash],
    );
  },

  async touchSessionById(sessionId: string): Promise<void> {
    await pool.query(
      `UPDATE user_sessions SET last_active_at = NOW()
       WHERE id = $1 AND revoked_at IS NULL AND expires_at > NOW()
         AND last_active_at < NOW() - INTERVAL '1 minute'`,
      [sessionId],
    );
  },

  /**
   * Update session's IP / UA / fingerprint from a request; rerun risk
   * analysis and auto-revoke on major hijacking signals (UA mismatch on
   * an existing fingerprint). Returns null if session was not found.
   */
  async updateSessionFromRequest(params: {
    sessionId: string;
    req: Request;
    ipAddress: string;
    userAgent: string | null;
  }): Promise<{ ok: boolean; riskLevel: RiskLevel; autoRevoked: boolean; reason?: string } | null> {
    const session = await UserSessionModel.findById(params.sessionId);
    if (!session) return null;

    // If revoked already, nothing to do.
    if (session.revoked_at) return { ok: false, riskLevel: session.risk_level, autoRevoked: true, reason: 'session revoked' };

    const components = DeviceFingerprintService.extractComponents(params.req);
    const newFingerprint = DeviceFingerprintService.generate(params.req, components);
    const newInfo = DeviceFingerprintService.parseDeviceInfo(params.req);
    const newGeo = await DeviceFingerprintService.lookupGeo(params.ipAddress);

    let autoRevoked = false;
    let reason: string | undefined;
    const newFlags: string[] = session.anomaly_flags ? [...session.anomaly_flags] : [];
    let newScore = session.anomaly_score;

    // Hijacking signal: fingerprint changed for existing session + UA major change
    if (session.device_fingerprint && session.device_fingerprint !== newFingerprint) {
      if (session.os_name && newInfo.os_name && session.os_name !== newInfo.os_name) {
        newFlags.push('UA_MISMATCH');
        newScore = Math.min(100, newScore + 55);
        if (env.SESSION_AUTO_REVOKE_HIJACK !== 'false') {
          autoRevoked = true;
          reason = 'Fingerprint + OS mismatch (potential hijack)';
          await pool.query(
            `UPDATE user_sessions SET revoked_at = NOW() WHERE id = $1`,
            [session.id],
          );
          await UserSessionModel.createAlert({
            userId: session.user_id,
            sessionId: session.id,
            alertType: 'SESSION_HIJACK',
            severity: 'critical',
            message: 'Session terminated: major device/OS mismatch detected mid-session.',
            metadata: {
              oldOs: session.os_name,
              newOs: newInfo.os_name,
              oldFingerprint: session.device_fingerprint?.slice(0, 16),
              newFingerprint: newFingerprint.slice(0, 16),
            },
            deliveredVia: ['in_app', 'email'],
          });
          try {
            const emailSvc = new EmailService();
            const { rows } = await pool.query(`SELECT email FROM users WHERE id = $1`, [session.user_id]);
            if (rows[0]?.email) {
              emailSvc.sendEmail({
                to: [rows[0].email],
                subject: '🚨 Suspicious activity on your account',
                htmlContent: `
                  <div style="font-family: Arial, sans-serif;">
                    <h2 style="color: #DC2626;">Possible session hijack detected</h2>
                    <p>An active session had a major device change and was automatically terminated.</p>
                    <ul>
                      <li><strong>Session IP:</strong> ${session.ip_address || 'Unknown'}</li>
                      <li><strong>New IP:</strong> ${params.ipAddress || 'Unknown'}</li>
                      <li><strong>Reason:</strong> ${reason}</li>
                      <li><strong>Time:</strong> ${new Date().toUTCString()}</li>
                    </ul>
                    <p>If this wasn't you, change your password and review all active sessions immediately.</p>
                  </div>`,
                textContent: `Possible session hijack on your account. ${reason} Review active sessions now.`,
              }).catch(() => {});
            }
          } catch { /* ignore */ }
        }
      }
    }

    // Mid-session geographic jump
    if (
      session.geo_latitude != null && session.geo_longitude != null &&
      newGeo.latitude != null && newGeo.longitude != null &&
      session.last_active_at
    ) {
      const hoursDelta = Math.max(0.1, (Date.now() - session.last_active_at.getTime()) / 3600_000);
      const travel = DeviceFingerprintService.detectImpossibleTravel({
        lat1: session.geo_latitude,
        lon1: session.geo_longitude,
        lat2: newGeo.latitude,
        lon2: newGeo.longitude,
        hoursDelta,
      });
      if (travel.impossible && !newFlags.includes('RAPID_GEO_JUMP_MIDSESSION')) {
        newFlags.push('RAPID_GEO_JUMP_MIDSESSION');
        newScore = Math.min(100, newScore + 30);
      }
    }

    if (!autoRevoked) {
      // Persist latest signals
      await UserSessionModel.updateSession(session.id, {
        ip_address: params.ipAddress,
        user_agent: params.userAgent,
        device_fingerprint: newFingerprint,
        device_type: newInfo.device_type,
        browser_name: newInfo.browser_name,
        browser_version: newInfo.browser_version,
        os_name: newInfo.os_name,
        os_version: newInfo.os_version,
        platform: newInfo.platform,
        is_mobile: newInfo.is_mobile,
        is_tablet: newInfo.is_tablet,
        is_desktop: newInfo.is_desktop,
        geo_country: newGeo.country,
        geo_region: newGeo.region,
        geo_city: newGeo.city,
        geo_latitude: newGeo.latitude,
        geo_longitude: newGeo.longitude,
        geo_tz: newGeo.timezone,
        geo_network: newGeo.network,
        is_vpn: newGeo.is_vpn,
        is_proxy: newGeo.is_proxy,
        is_tor: newGeo.is_tor,
        is_datacenter: newGeo.is_datacenter,
        anomaly_score: newScore,
        anomaly_flags: newFlags.length ? newFlags : null,
        risk_level: scoreToLevel(newScore),
      });
    }

    return {
      ok: !autoRevoked,
      riskLevel: scoreToLevel(newScore),
      autoRevoked,
      reason,
    };
  },

  async expireInactiveSessions(): Promise<number> {
    const { rowCount } = await pool.query(
      `UPDATE user_sessions SET revoked_at = NOW()
       WHERE revoked_at IS NULL AND last_active_at < NOW() - INTERVAL '30 days'`,
    );
    return rowCount ?? 0;
  },

  // ── Alerts & Trust ────────────────────────────────────────────────────

  async listAlerts(userId: string, unreadOnly = false, limit = 100) {
    return UserSessionModel.listAlerts(userId, unreadOnly, limit);
  },

  async markAlertRead(alertId: string, userId: string): Promise<boolean> {
    return UserSessionModel.markAlertRead(alertId, userId);
  },

  async countUnreadAlerts(userId: string): Promise<number> {
    return UserSessionModel.countUnreadAlerts(userId);
  },

  async markTrustedDevice(params: { userId: string; fingerprint: string; nickname?: string; trustDays?: number; geoCountry?: string; }): Promise<TrustedDevice> {
    return UserSessionModel.markTrusted(params);
  },

  async untrustDevice(userId: string, trustedDeviceId: string): Promise<boolean> {
    return UserSessionModel.untrustDevice(userId, trustedDeviceId);
  },

  async getTrustedDevices(userId: string): Promise<TrustedDevice[]> {
    return UserSessionModel.getTrustedDevices(userId);
  },

  async findSessionByToken(tokenHash: string): Promise<UserSession | null> {
    return UserSessionModel.findByTokenHash(tokenHash);
  },

  // ── Email helpers ─────────────────────────────────────────────────────

  async sendNewSessionAlert(params: {
    userEmail: string;
    deviceName: string;
    ipAddress: string | null;
    createdAt: Date;
    geoCountry?: string | null;
    geoCity?: string | null;
    riskLevel?: RiskLevel;
    anomalyScore?: number;
    flags?: string[];
  }): Promise<void> {
    const emailService = new EmailService();
    const { userEmail, deviceName, ipAddress, createdAt, geoCountry, geoCity, riskLevel, anomalyScore, flags } = params;
    const isElevated = riskLevel === 'high' || riskLevel === 'critical';
    const subject = isElevated
      ? '⚠️ Suspicious login to your MentorMinds account'
      : 'New login to your MentorMinds account';
    const riskColor =
      riskLevel === 'critical' ? '#DC2626' : riskLevel === 'high' ? '#EA580C' : riskLevel === 'medium' ? '#CA8A04' : '#059669';
    await emailService.sendEmail({
      to: [userEmail],
      subject,
      htmlContent: `
        <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto;">
          ${isElevated ? `<div style="background:#FEF2F2;color:#991B1B;padding:10px 14px;border-radius:8px;margin-bottom:16px;font-weight:600;">We noticed unusual activity with this login.</div>` : ''}
          <h2 style="color:#4F46E5;">${isElevated ? 'Suspicious login' : 'New login'}</h2>
          <p>A new session was started on your account.</p>
          <ul style="line-height: 1.7;">
            <li><strong>Device:</strong> ${deviceName}</li>
            <li><strong>IP Address:</strong> ${ipAddress ?? 'Unknown'}</li>
            ${geoCountry ? `<li><strong>Location:</strong> ${[geoCity, geoCountry].filter(Boolean).join(', ')}</li>` : ''}
            <li><strong>Time:</strong> ${createdAt.toUTCString()}</li>
            ${riskLevel ? `<li><strong>Risk Level:</strong> <span style="color:${riskColor};font-weight:600;">${riskLevel.toUpperCase()}</span> ${typeof anomalyScore === 'number' ? `(${anomalyScore}/100)` : ''}</li>` : ''}
            ${flags && flags.length ? `<li><strong>Signals:</strong> ${flags.join(', ')}</li>` : ''}
          </ul>
          <p style="color:#374151;">If this wasn't you, <strong>revoke this session</strong> from your account settings and update your password.</p>
        </div>`,
      textContent:
        `${subject}\n\n` +
        `Device: ${deviceName}\nIP: ${ipAddress ?? 'Unknown'}\n` +
        (geoCountry ? `Location: ${[geoCity, geoCountry].filter(Boolean).join(', ')}\n` : '') +
        `Time: ${createdAt.toUTCString()}\n` +
        (riskLevel ? `Risk: ${riskLevel.toUpperCase()} (${anomalyScore ?? '?'}/100)\n` : '') +
        (flags && flags.length ? `Signals: ${flags.join(', ')}\n\n` : '\n') +
        `If this wasn't you, revoke the session from your account settings.`,
      priority: isElevated ? 'high' : 'normal',
    });
  },
};
