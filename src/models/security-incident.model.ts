/**
 * Security Incident Model
 *
 * Persists incidents raised by ThreatDetectionService (statistical/heuristic
 * anomaly scoring, see ml-security.service.ts) and the actions taken by
 * IncidentResponseService.
 *
 * Part of issue #840 "Advanced Threat Detection".
 */

import pool from "../config/database";

export type SecuritySeverity = "low" | "medium" | "high" | "critical";
export type SecurityIncidentStatus =
  | "open"
  | "auto_resolved"
  | "escalated"
  | "dismissed";

export interface SecurityIncident {
  id: string;
  user_id: string | null;
  incident_type: string;
  severity: SecuritySeverity;
  score: number | null;
  details: Record<string, any>;
  status: SecurityIncidentStatus;
  response_action: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateSecurityIncidentPayload {
  userId: string | null;
  incidentType: string;
  severity: SecuritySeverity;
  score?: number | null;
  details?: Record<string, any>;
  status?: SecurityIncidentStatus;
  responseAction?: string | null;
}

export const SecurityIncidentModel = {
  /** Insert a new security incident record. */
  async create(
    entry: CreateSecurityIncidentPayload,
  ): Promise<SecurityIncident> {
    const { rows } = await pool.query<SecurityIncident>(
      `INSERT INTO security_incidents
         (user_id, incident_type, severity, score, details, status, response_action)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        entry.userId,
        entry.incidentType,
        entry.severity,
        entry.score ?? null,
        entry.details ?? {},
        entry.status ?? "open",
        entry.responseAction ?? null,
      ],
    );
    return rows[0];
  },

  /** Fetch a user's recent security incidents within the last `windowMinutes`. */
  async findRecentByUser(
    userId: string,
    windowMinutes: number,
  ): Promise<SecurityIncident[]> {
    const { rows } = await pool.query<SecurityIncident>(
      `SELECT * FROM security_incidents
       WHERE user_id = $1
         AND created_at >= NOW() - ($2 || ' minutes')::interval
       ORDER BY created_at DESC`,
      [userId, windowMinutes],
    );
    return rows;
  },

  /** Update an incident's status and the response action that was taken. */
  async updateStatus(
    id: string,
    status: SecurityIncidentStatus,
    responseAction?: string | null,
  ): Promise<SecurityIncident | null> {
    const { rows } = await pool.query<SecurityIncident>(
      `UPDATE security_incidents
       SET status = $2,
           response_action = COALESCE($3, response_action),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, status, responseAction ?? null],
    );
    return rows[0] ?? null;
  },
};
