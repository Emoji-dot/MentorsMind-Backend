/**
 * Incident Response Service
 *
 * Automated response actions taken in reaction to a ThreatDetectionResult:
 *   - always records a security_incidents row
 *   - critical severity: locks the account (users.locked_until, reusing the
 *     existing column instead of adding a new one) for 1 hour and sends a
 *     security-alert notification
 *   - high severity: sends a security-alert notification, no lock
 *   - low/medium severity: recorded only, no user-facing action
 *
 * Part of issue #840 "Advanced Threat Detection".
 */

import pool from "../config/database";
import { logger } from "../utils/logger";
import { NotificationService } from "./notification.service";
import { NotificationType, NotificationChannel } from "../models/notifications.model";
import { AuditLogService } from "./auditLog.service";
import {
  SecurityIncidentModel,
  SecuritySeverity,
} from "../models/security-incident.model";
import type { ThreatDetectionResult } from "./threat-detection.service";

const ACCOUNT_LOCK_DURATION_MS = 60 * 60 * 1000; // 1 hour

async function lockAccount(userId: string): Promise<void> {
  await pool.query(
    `UPDATE users SET locked_until = $2, updated_at = NOW() WHERE id = $1`,
    [userId, new Date(Date.now() + ACCOUNT_LOCK_DURATION_MS)],
  );
}

async function sendSecurityAlert(
  userId: string,
  severity: SecuritySeverity,
  incidentType: string,
  score: number,
): Promise<void> {
  try {
    await NotificationService.sendNotification({
      userId,
      type: NotificationType.SYSTEM_ALERT,
      channels: [NotificationChannel.EMAIL, NotificationChannel.IN_APP],
      title: "Unusual account activity detected",
      message:
        severity === "critical"
          ? "We detected highly unusual activity on your account and have temporarily locked it as a precaution. If this wasn't you, please reset your password."
          : "We detected unusual activity on your account. If this wasn't you, please review your recent sessions and consider changing your password.",
      data: { incidentType, severity, score },
    });
  } catch (error) {
    logger.error("Failed to send security alert notification", {
      userId,
      incidentType,
      error: error instanceof Error ? error.message : "unknown error",
    });
  }
}

export const IncidentResponseService = {
  async handle(
    userId: string,
    detection: ThreatDetectionResult,
  ): Promise<void> {
    if (!detection.threatDetected || !detection.severity || !detection.incidentType) {
      return;
    }

    const { severity, incidentType, score } = detection;

    const incident = await SecurityIncidentModel.create({
      userId,
      incidentType,
      severity,
      score,
      details: { score },
      status: "open",
      responseAction: "none",
    });

    let responseAction: string = "none";
    let status: "open" | "auto_resolved" | "escalated" = "open";

    if (severity === "critical") {
      try {
        await lockAccount(userId);
        responseAction = "account_locked";
        status = "escalated";
      } catch (error) {
        logger.error("Failed to lock account in response to critical threat", {
          userId,
          error: error instanceof Error ? error.message : "unknown error",
        });
      }
      await sendSecurityAlert(userId, severity, incidentType, score);
      if (responseAction === "account_locked") {
        responseAction = "account_locked,alert_sent";
      } else {
        responseAction = "alert_sent";
      }
    } else if (severity === "high") {
      await sendSecurityAlert(userId, severity, incidentType, score);
      responseAction = "alert_sent";
      status = "auto_resolved";
    } else {
      // low / medium: record only
      responseAction = "none";
      status = "auto_resolved";
    }

    await SecurityIncidentModel.updateStatus(incident.id, status, responseAction);

    try {
      await AuditLogService.log({
        userId,
        action: "SECURITY_INCIDENT_DETECTED",
        resourceType: "security_incident",
        resourceId: incident.id,
        newValue: { incidentType, severity, score, responseAction, status },
        metadata: { source: "threat-detection" },
      });
    } catch (error) {
      logger.error("Failed to write audit log for security incident", {
        userId,
        incidentId: incident.id,
        error: error instanceof Error ? error.message : "unknown error",
      });
    }

    logger.warn("Security incident handled", {
      userId,
      incidentId: incident.id,
      incidentType,
      severity,
      responseAction,
    });
  },
};
