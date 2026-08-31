/**
 * Risk Assessment Service
 *
 * Computes a continuous, per-request risk score (0-100) for the zero-trust
 * middleware based on concrete signals already available in the system —
 * no ML, just explainable heuristics whose weights are documented inline.
 *
 * Part of issue #839 "Implement Zero Trust Security Model".
 */

import crypto from "crypto";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import { AccessRiskModel } from "../models/access-risk.model";
import { LoginAttemptsService } from "./loginAttempts.service";
import { extractIpAddress } from "./auditLog.service";
import { logger } from "../utils/logger.utils";

export interface RiskAssessmentResult {
  score: number;
  signals: string[];
  ipAddress: string;
  userAgent: string | null;
  deviceFingerprint: string;
}

// ─── Signal weights ─────────────────────────────────────────────────────────
// Each weight is a deliberately conservative point value on the 0-100 scale.
// Multiple weaker signals can combine to cross a threshold; a single strong
// signal (e.g. many recent failed logins) can push risk high on its own.

const WEIGHTS = {
  NEW_IP: 25, // IP not seen for this user in the lookback window
  FAILED_LOGIN_STEP: 10, // per failed attempt (capped)
  FAILED_LOGIN_MAX: 30,
  IMPOSSIBLE_TRAVEL: 35, // too many distinct IPs within the last hour
  UNUSUAL_HOUR: 15, // request made far outside the user's typical hours
  NEW_DEVICE_FINGERPRINT: 20, // fingerprint differs from the last seen one
} as const;

const LOOKBACK_DAYS = 30;
const IMPOSSIBLE_TRAVEL_WINDOW_MINUTES = 60;
const IMPOSSIBLE_TRAVEL_IP_THRESHOLD = 3; // >3 distinct IPs in an hour looks anomalous
const TYPICAL_HOUR_SAMPLE_LIMIT = 200;

/** Compute a stable per-device fingerprint from IP + User-Agent. */
function computeDeviceFingerprint(ip: string, userAgent: string | null): string {
  return crypto
    .createHash("sha256")
    .update(`${ip}|${userAgent ?? ""}`)
    .digest("hex");
}

export const RiskAssessmentService = {
  /**
   * Assess the risk of the current request for the authenticated user.
   * Persists the assessment (best-effort) for future signal computation.
   */
  async assess(req: AuthenticatedRequest): Promise<{ score: number; signals: string[] }> {
    const userId = req.user?.userId;
    const signals: string[] = [];
    let score = 0;

    const ipAddress = extractIpAddress(req);
    const userAgent = (req.headers["user-agent"] as string) || null;
    const deviceFingerprint = computeDeviceFingerprint(ipAddress, userAgent);

    if (!userId) {
      // Should not normally happen — the middleware guards on req.user first —
      // but assess defensively rather than throwing.
      return { score: 0, signals: ["no-authenticated-user"] };
    }

    try {
      const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
      const recent = await AccessRiskModel.getRecentForUser(userId, LOOKBACK_DAYS * 24 * 60);

      // Signal 1: new IP for this user
      const knownIps = new Set(recent.map((r) => r.ip_address).filter(Boolean));
      if (recent.length > 0 && !knownIps.has(ipAddress)) {
        score += WEIGHTS.NEW_IP;
        signals.push(`new-ip:${ipAddress}`);
      }

      // Signal 2: recent failed login attempts (via existing lockout service)
      if (req.user?.email) {
        try {
          const status = await LoginAttemptsService.getStatus(req.user.email);
          if (status.attempts > 0) {
            const weight = Math.min(
              status.attempts * WEIGHTS.FAILED_LOGIN_STEP,
              WEIGHTS.FAILED_LOGIN_MAX,
            );
            score += weight;
            signals.push(`recent-failed-logins:${status.attempts}`);
          }
        } catch (err) {
          logger.warn({ err }, "risk-assessment: failed to read login attempt status");
        }
      }

      // Signal 3: impossible travel — too many distinct IPs within the last hour
      const travelSince = new Date(Date.now() - IMPOSSIBLE_TRAVEL_WINDOW_MINUTES * 60 * 1000);
      const distinctIps = await AccessRiskModel.countDistinctIpsSince(userId, travelSince);
      if (distinctIps >= IMPOSSIBLE_TRAVEL_IP_THRESHOLD) {
        score += WEIGHTS.IMPOSSIBLE_TRAVEL;
        signals.push(`impossible-travel:${distinctIps}-ips-in-${IMPOSSIBLE_TRAVEL_WINDOW_MINUTES}m`);
      }

      // Signal 4: unusual hour-of-day, compared against the user's historical pattern.
      // Simple heuristic: bucket past access timestamps by hour, find the most
      // common hours (the "typical" set), and flag if the current hour is far
      // from all of them. Requires a minimum sample size to avoid false positives
      // for new users.
      const sample = recent.slice(0, TYPICAL_HOUR_SAMPLE_LIMIT);
      if (sample.length >= 10) {
        const hourCounts = new Array(24).fill(0);
        for (const r of sample) {
          hourCounts[new Date(r.created_at).getUTCHours()] += 1;
        }
        const maxCount = Math.max(...hourCounts);
        const typicalHours = hourCounts
          .map((c, h) => (c >= maxCount * 0.5 ? h : -1))
          .filter((h) => h >= 0);
        const currentHour = new Date().getUTCHours();
        const minDistance = Math.min(
          ...typicalHours.map((h) => {
            const diff = Math.abs(h - currentHour);
            return Math.min(diff, 24 - diff);
          }),
        );
        if (minDistance >= 6) {
          score += WEIGHTS.UNUSUAL_HOUR;
          signals.push(`unusual-hour:${currentHour}h-utc`);
        }
      }

      // Signal 5: device fingerprint changed since the last seen request
      const lastFingerprint = recent[0]?.device_fingerprint;
      if (lastFingerprint && lastFingerprint !== deviceFingerprint) {
        score += WEIGHTS.NEW_DEVICE_FINGERPRINT;
        signals.push("new-device-fingerprint");
      }
    } catch (err) {
      logger.error({ err, userId }, "risk-assessment: signal computation failed");
      signals.push("assessment-error-fallback");
    }

    score = Math.max(0, Math.min(100, score));

    // Persist the assessment for future signal computation. Fire-and-forget:
    // a logging failure should never block the request path.
    AccessRiskModel.record({
      userId,
      ipAddress,
      userAgent,
      deviceFingerprint,
      riskScore: score,
      decision: "assessed", // the middleware records the actual policy decision separately via audit log
      resource: req.originalUrl,
    }).catch((err) => {
      logger.error({ err, userId }, "risk-assessment: failed to persist assessment");
    });

    return { score, signals };
  },
};
