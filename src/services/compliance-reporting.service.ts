/**
 * Automated Compliance Reporting Service
 *
 * Provides AML transaction monitoring, KYC tracking, suspicious activity
 * detection, and automated regulatory report generation.
 */

import pool from "../config/database";
import { logger } from "../utils/logger.utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AMLAlert {
  id: string;
  userId: string;
  alertType:
    | "unusual-volume"
    | "structuring"
    | "high-risk-country"
    | "velocity";
  severity: "low" | "medium" | "high" | "critical";
  transactions: string[];
  riskScore: number;
  status: "open" | "investigating" | "cleared" | "reported";
  createdAt: Date;
}

export interface ComplianceReport {
  period: string;
  totalTransactions: number;
  flaggedTransactions: number;
  kycCompliance: number;
  amlAlerts: number;
  reportedCases: number;
}

export interface SARReport {
  alertId: string;
  userId: string;
  reportedAt: Date;
  summary: string;
  transactions: string[];
  riskScore: number;
}

export interface KYCStatus {
  userId: string;
  verified: boolean;
  level: "none" | "basic" | "enhanced";
  verifiedAt?: Date;
  expiresAt?: Date;
  riskRating: "low" | "medium" | "high";
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Countries flagged as high-risk for cross-border transaction monitoring */
const HIGH_RISK_COUNTRIES = ["KP", "IR", "SY", "CU", "VE"];

/** Daily transaction volume threshold (USD) that triggers unusual-volume alert */
const UNUSUAL_VOLUME_THRESHOLD_USD = 10_000;

/** Structuring detection: multiple transactions just below CTR threshold */
const STRUCTURING_THRESHOLD_USD = 9_000;
const STRUCTURING_COUNT_THRESHOLD = 3;

/** Velocity: max transactions per hour before velocity alert */
const VELOCITY_HOURLY_LIMIT = 10;

// ─── Service ──────────────────────────────────────────────────────────────────

export class ComplianceReportingService {
  // ── AML Monitoring ─────────────────────────────────────────────────────────

  /**
   * Analyse a batch of recent transactions for AML signals.
   * Returns any newly created alerts.
   */
  async runAMLMonitoring(userId: string): Promise<AMLAlert[]> {
    const alerts: AMLAlert[] = [];

    const [volumeAlert, structuringAlert, velocityAlert] = await Promise.all([
      this.checkUnusualVolume(userId),
      this.checkStructuring(userId),
      this.checkVelocity(userId),
    ]);

    for (const alert of [volumeAlert, structuringAlert, velocityAlert]) {
      if (alert) alerts.push(alert);
    }

    if (alerts.length) {
      logger.warn(
        { userId, alertCount: alerts.length },
        "AML alerts generated",
      );
    }

    return alerts;
  }

  private async checkUnusualVolume(userId: string): Promise<AMLAlert | null> {
    const result = await pool.query<{ total: string; ids: string[] }>(
      `SELECT COALESCE(SUM(amount), 0) AS total,
              ARRAY_AGG(id::text) AS ids
       FROM transactions
       WHERE user_id = $1
         AND created_at >= NOW() - INTERVAL '1 day'`,
      [userId],
    );

    const total = parseFloat(result.rows[0]?.total ?? "0");
    if (total < UNUSUAL_VOLUME_THRESHOLD_USD) return null;

    return this.buildAlert(
      userId,
      "unusual-volume",
      result.rows[0].ids ?? [],
      total,
    );
  }

  private async checkStructuring(userId: string): Promise<AMLAlert | null> {
    const result = await pool.query<{ count: string; ids: string[] }>(
      `SELECT COUNT(*) AS count,
              ARRAY_AGG(id::text) AS ids
       FROM transactions
       WHERE user_id = $1
         AND amount BETWEEN $2 AND $3
         AND created_at >= NOW() - INTERVAL '1 day'`,
      [userId, STRUCTURING_THRESHOLD_USD * 0.9, STRUCTURING_THRESHOLD_USD],
    );

    const count = parseInt(result.rows[0]?.count ?? "0", 10);
    if (count < STRUCTURING_COUNT_THRESHOLD) return null;

    return this.buildAlert(
      userId,
      "structuring",
      result.rows[0].ids ?? [],
      count * 1000,
    );
  }

  private async checkVelocity(userId: string): Promise<AMLAlert | null> {
    const result = await pool.query<{ count: string; ids: string[] }>(
      `SELECT COUNT(*) AS count,
              ARRAY_AGG(id::text) AS ids
       FROM transactions
       WHERE user_id = $1
         AND created_at >= NOW() - INTERVAL '1 hour'`,
      [userId],
    );

    const count = parseInt(result.rows[0]?.count ?? "0", 10);
    if (count < VELOCITY_HOURLY_LIMIT) return null;

    return this.buildAlert(
      userId,
      "velocity",
      result.rows[0].ids ?? [],
      count * 100,
    );
  }

  private buildAlert(
    userId: string,
    alertType: AMLAlert["alertType"],
    transactions: string[],
    riskScore: number,
  ): AMLAlert {
    const severity = this.calculateSeverity(riskScore);
    return {
      id: `aml-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      userId,
      alertType,
      severity,
      transactions,
      riskScore,
      status: "open",
      createdAt: new Date(),
    };
  }

  private calculateSeverity(riskScore: number): AMLAlert["severity"] {
    if (riskScore >= 50_000) return "critical";
    if (riskScore >= 20_000) return "high";
    if (riskScore >= 10_000) return "medium";
    return "low";
  }

  // ── Cross-border monitoring ─────────────────────────────────────────────────

  async checkHighRiskCountry(
    userId: string,
    countryCode: string,
  ): Promise<AMLAlert | null> {
    if (!HIGH_RISK_COUNTRIES.includes(countryCode.toUpperCase())) return null;

    const result = await pool.query<{ ids: string[] }>(
      `SELECT ARRAY_AGG(id::text) AS ids FROM transactions WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '7 days'`,
      [userId],
    );

    return this.buildAlert(
      userId,
      "high-risk-country",
      result.rows[0]?.ids ?? [],
      30_000,
    );
  }

  // ── KYC Tracking ───────────────────────────────────────────────────────────

  async getKYCStatus(userId: string): Promise<KYCStatus> {
    const result = await pool.query(
      `SELECT kyc_verified, kyc_level, kyc_verified_at, kyc_expires_at, kyc_risk_rating
       FROM users WHERE id = $1`,
      [userId],
    );

    const row = result.rows[0];
    if (!row) {
      return { userId, verified: false, level: "none", riskRating: "high" };
    }

    return {
      userId,
      verified: row.kyc_verified ?? false,
      level: row.kyc_level ?? "none",
      verifiedAt: row.kyc_verified_at,
      expiresAt: row.kyc_expires_at,
      riskRating: row.kyc_risk_rating ?? "medium",
    };
  }

  async getKYCComplianceRate(): Promise<number> {
    const result = await pool.query<{ total: string; verified: string }>(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE kyc_verified = true) AS verified
       FROM users`,
    );
    const { total, verified } = result.rows[0];
    return parseInt(total, 10) === 0
      ? 100
      : Math.round((parseInt(verified, 10) / parseInt(total, 10)) * 100);
  }

  // ── Compliance Reports ──────────────────────────────────────────────────────

  /**
   * Generate a compliance report for a given calendar period (e.g. "2026-05").
   */
  async generateReport(period: string): Promise<ComplianceReport> {
    const [year, month] = period.split("-").map(Number);
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);

    const [txResult, kycRate] = await Promise.all([
      pool.query<{ total: string; flagged: string }>(
        `SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE flagged = true) AS flagged
         FROM transactions
         WHERE created_at >= $1 AND created_at < $2`,
        [start, end],
      ),
      this.getKYCComplianceRate(),
    ]);

    const total = parseInt(txResult.rows[0]?.total ?? "0", 10);
    const flagged = parseInt(txResult.rows[0]?.flagged ?? "0", 10);

    return {
      period,
      totalTransactions: total,
      flaggedTransactions: flagged,
      kycCompliance: kycRate,
      amlAlerts: flagged,
      reportedCases: 0, // populated from SAR store in production
    };
  }

  // ── SAR Generation ─────────────────────────────────────────────────────────

  /**
   * Generate a Suspicious Activity Report from an open AML alert.
   */
  generateSAR(alert: AMLAlert): SARReport {
    if (alert.status !== "open" && alert.status !== "investigating") {
      throw new Error(
        `Cannot generate SAR for alert with status '${alert.status}'`,
      );
    }

    return {
      alertId: alert.id,
      userId: alert.userId,
      reportedAt: new Date(),
      summary: `Suspicious activity detected: ${alert.alertType}. Risk score: ${alert.riskScore}. Severity: ${alert.severity}.`,
      transactions: alert.transactions,
      riskScore: alert.riskScore,
    };
  }
}

export const complianceReportingService = new ComplianceReportingService();
