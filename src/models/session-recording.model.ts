import pool, { db } from "../config/database";

export interface SessionRecordingRecord {
  id: string;
  session_id: string;
  mentor_id: string;
  mentee_id: string;
  s3_key: string;
  s3_bucket: string;
  file_size: number | null;
  duration_seconds: number | null;
  status: "recording" | "processing" | "ready" | "deleted" | "failed";
  mentor_consent: boolean;
  mentee_consent: boolean;
  mentor_consent_timestamp: Date | null;
  mentee_consent_timestamp: Date | null;
  consent_ip_address: string | null;
  consent_user_agent: string | null;
  recording_started_at: Date | null;
  recording_ended_at: Date | null;
  expires_at: Date;
  metadata: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface CreateRecordingPayload {
  sessionId: string;
  mentorId: string;
  menteeId: string;
  s3Key: string;
  s3Bucket: string;
  expiresAt: Date;
}

export interface UpdateConsentPayload {
  mentorConsent?: boolean;
  menteeConsent?: boolean;
  consentIpAddress?: string;
  consentUserAgent?: string;
}

export interface UpdateRecordingStatusPayload {
  status: "recording" | "processing" | "ready" | "deleted" | "failed";
  fileSize?: number;
  durationSeconds?: number;
  recordingStartedAt?: Date;
  recordingEndedAt?: Date;
  metadata?: Record<string, any>;
}

/**
 * Session Recording Model - Database operations for session recordings
 */
export const SessionRecordingModel = {
  /**
   * Create a new recording record
   */
  async create(
    payload: CreateRecordingPayload,
  ): Promise<SessionRecordingRecord> {
    const query = `
      INSERT INTO session_recordings (
        session_id, mentor_id, mentee_id, s3_key, s3_bucket, expires_at
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;

    const { rows } = await db.query(query, [
      payload.sessionId,
      payload.mentorId,
      payload.menteeId,
      payload.s3Key,
      payload.s3Bucket,
      payload.expiresAt,
    ]);

    return rows[0];
  },

  /**
   * Find recording by ID
   */
  async findById(id: string): Promise<SessionRecordingRecord | null> {
    const query = "SELECT * FROM session_recordings WHERE id = $1";
    const { rows } = await db.query(query, [id]);
    return rows[0] ?? null;
  },

  /**
   * Find recording by session ID
   */
  async findBySessionId(
    sessionId: string,
  ): Promise<SessionRecordingRecord | null> {
    const query =
      "SELECT * FROM session_recordings WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1";
    const { rows } = await pool.query<SessionRecordingRecord>(query, [
      sessionId,
    ]);
    return rows[0] ?? null;
  },

  /**
   * Find recordings by user ID (either as mentor or mentee)
   */
  async findByUserId(userId: string): Promise<SessionRecordingRecord[]> {
    const query = `
      SELECT * FROM session_recordings
      WHERE mentor_id = $1 OR mentee_id = $1
      ORDER BY created_at DESC
    `;
    const { rows } = await db.query(query, [userId]);
    return rows;
  },

  /**
   * Find recordings by user ID with consent check
   */
  async findAccessibleByUserId(
    userId: string,
  ): Promise<SessionRecordingRecord[]> {
    const query = `
      SELECT * FROM session_recordings
      WHERE (mentor_id = $1 OR mentee_id = $1)
        AND status = 'ready'
        AND mentor_consent = TRUE
        AND mentee_consent = TRUE
        AND expires_at > NOW()
      ORDER BY created_at DESC
    `;
    const { rows } = await db.query(query, [userId]);
    return rows;
  },

  /**
   * Update consent for a recording
   */
  async updateConsent(
    id: string,
    userId: string,
    payload: UpdateConsentPayload,
  ): Promise<SessionRecordingRecord | null> {
    const recording = await this.findById(id);
    if (!recording) return null;

    const isMentor = recording.mentor_id === userId;
    const isMentee = recording.mentee_id === userId;

    if (!isMentor && !isMentee) {
      throw new Error(
        "User not authorized to update consent for this recording",
      );
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (isMentor && payload.mentorConsent !== undefined) {
      updates.push(
        `mentor_consent = $${idx}, mentor_consent_timestamp = NOW()`,
      );
      values.push(payload.mentorConsent);
      idx++;
    }

    if (isMentee && payload.menteeConsent !== undefined) {
      updates.push(
        `mentee_consent = $${idx}, mentee_consent_timestamp = NOW()`,
      );
      values.push(payload.menteeConsent);
      idx++;
    }

    if (payload.consentIpAddress) {
      updates.push(`consent_ip_address = $${idx}`);
      values.push(payload.consentIpAddress);
      idx++;
    }

    if (payload.consentUserAgent) {
      updates.push(`consent_user_agent = $${idx}`);
      values.push(payload.consentUserAgent);
      idx++;
    }

    if (updates.length === 0) {
      return recording;
    }

    values.push(id);

    const query = `
      UPDATE session_recordings
      SET ${updates.join(", ")}
      WHERE id = $${idx}
      RETURNING *
    `;

    const { rows } = await db.query(query, values);
    return rows[0] ?? null;
  },

  /**
   * Update recording status and metadata
   */
  async updateStatus(
    id: string,
    payload: UpdateRecordingStatusPayload,
  ): Promise<SessionRecordingRecord | null> {
    const updates: string[] = [`status = $1`];
    const values: unknown[] = [payload.status];
    let idx = 2;

    if (payload.fileSize) {
      updates.push(`file_size = $${idx++}`);
      values.push(payload.fileSize);
    }

    if (payload.durationSeconds) {
      updates.push(`duration_seconds = $${idx++}`);
      values.push(payload.durationSeconds);
    }

    if (payload.recordingStartedAt) {
      updates.push(`recording_started_at = $${idx++}`);
      values.push(payload.recordingStartedAt);
    }

    if (payload.recordingEndedAt) {
      updates.push(`recording_ended_at = $${idx++}`);
      values.push(payload.recordingEndedAt);
    }

    if (payload.metadata) {
      updates.push(`metadata = metadata || $${idx++}`);
      values.push(JSON.stringify(payload.metadata));
    }

    values.push(id);

    const query = `
      UPDATE session_recordings
      SET ${updates.join(", ")}
      WHERE id = $${idx}
      RETURNING *
    `;

    const { rows } = await db.query(query, values);
    return rows[0] ?? null;
  },

  /**
   * Find expired recordings that need cleanup
   */
  async findExpired(): Promise<SessionRecordingRecord[]> {
    const query = `
      SELECT * FROM session_recordings
      WHERE expires_at < NOW()
        AND status IN ('ready', 'processing')
      ORDER BY expires_at ASC
    `;
    const { rows } = await pool.query<SessionRecordingRecord>(query);
    return rows;
  },

  /**
   * Mark recording as deleted
   */
  async markAsDeleted(id: string): Promise<boolean> {
    const query = `
      UPDATE session_recordings
      SET status = 'deleted'
      WHERE id = $1
      RETURNING id
    `;
    const { rowCount } = await pool.query(query, [id]);
    return (rowCount ?? 0) > 0;
  },

  /**
   * Delete a recording (mark as deleted)
   */
  async delete(id: string): Promise<boolean> {
    const query = `
      UPDATE session_recordings
      SET status = 'deleted'
      WHERE id = $1
    `;
    const { rowCount } = await db.query(query, [id]);
    return (rowCount ?? 0) > 0;
  },

  /**
   * Check if both parties have consented
   */
  async hasFullConsent(id: string): Promise<boolean> {
    const query = `
      SELECT mentor_consent, mentee_consent
      FROM session_recordings
      WHERE id = $1
    `;
    const { rows } = await pool.query(query, [id]);
    if (rows.length === 0) return false;
    return rows[0].mentor_consent && rows[0].mentee_consent;
  },
};

export default SessionRecordingModel;
