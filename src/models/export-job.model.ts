import { db } from "../config/database";

export type ExportJobStatus = "pending" | "processing" | "completed" | "failed";
export type ExportFormat = "json" | "csv" | "pdf";
export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface ExportJob {
  id: string;
  user_id: string;
  status: ExportJobStatus;
  format: ExportFormat;
  storage_key: string | null;
  file_path?: string | null; // alias for storage_key
  error_message: string | null;
  expires_at: Date | null;
  downloaded_at: Date | null;
  metadata?: Record<string, any>;
  // Size tracking
  estimated_size_bytes: number | null;
  actual_size_bytes: number | null;
  // Admin approval (only set when estimated_size_bytes > 1 GB)
  approval_status: ApprovalStatus | null;
  approved_by: string | null;
  approved_at: Date | null;
  // BullMQ link for live progress
  bullmq_job_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export const ExportJobModel = {
  async create(
    userId: string,
    options: {
      format?: ExportFormat;
      estimatedSizeBytes?: number;
      approvalStatus?: ApprovalStatus | null;
      metadata?: Record<string, any>;
    } = {},
  ): Promise<ExportJob> {
    const { format = "json", estimatedSizeBytes, approvalStatus, metadata } = options;
    const query = `
      INSERT INTO export_jobs
        (user_id, status, format, estimated_size_bytes, approval_status, metadata)
      VALUES ($1, 'pending', $2, $3, $4, $5)
      RETURNING *;
    `;
    const { rows } = await db.query(query, [
      userId,
      format,
      estimatedSizeBytes ?? null,
      approvalStatus ?? null,
      JSON.stringify(metadata || {}),
    ]);
    return rows[0];
  },

  async findById(id: string): Promise<ExportJob | null> {
    const { rows } = await db.query("SELECT * FROM export_jobs WHERE id = $1;", [id]);
    return rows[0] || null;
  },

  async getStatus(id: string): Promise<ExportJob | null> {
    return this.findById(id);
  },

  async updateStatus(
    id: string,
    status: ExportJobStatus,
    storageKey?: string,
    errorMessage?: string,
    expiresAt?: Date,
    extraFields?: {
      actualSizeBytes?: number;
      bullmqJobId?: string;
    },
  ): Promise<void> {
    const query = `
      UPDATE export_jobs
      SET status          = $2,
          storage_key     = COALESCE($3, storage_key),
          error_message   = COALESCE($4, error_message),
          expires_at      = COALESCE($5, expires_at),
          actual_size_bytes = COALESCE($6, actual_size_bytes),
          bullmq_job_id   = COALESCE($7, bullmq_job_id),
          updated_at      = CURRENT_TIMESTAMP
      WHERE id = $1;
    `;
    await db.query(query, [
      id,
      status,
      storageKey ?? null,
      errorMessage ?? null,
      expiresAt ?? null,
      extraFields?.actualSizeBytes ?? null,
      extraFields?.bullmqJobId ?? null,
    ]);
  },

  async setBullmqJobId(id: string, bullmqJobId: string): Promise<void> {
    await db.query(
      `UPDATE export_jobs SET bullmq_job_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1;`,
      [id, bullmqJobId],
    );
  },

  async updateApprovalStatus(
    id: string,
    status: ApprovalStatus,
    approvedBy: string,
  ): Promise<ExportJob | null> {
    const { rows } = await db.query(
      `UPDATE export_jobs
       SET approval_status = $2,
           approved_by     = $3,
           approved_at     = CURRENT_TIMESTAMP,
           updated_at      = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *;`,
      [id, status, approvedBy],
    );
    return rows[0] || null;
  },

  async findPendingByUserId(userId: string): Promise<ExportJob | null> {
    const query = `
      SELECT * FROM export_jobs
      WHERE user_id = $1
        AND status IN ('pending', 'processing')
      ORDER BY created_at DESC
      LIMIT 1;
    `;
    const { rows } = await db.query(query, [userId]);
    return rows[0] || null;
  },

  async findLastCompletedByUserId(userId: string): Promise<ExportJob | null> {
    const query = `
      SELECT * FROM export_jobs
      WHERE user_id = $1
        AND status = 'completed'
      ORDER BY created_at DESC
      LIMIT 1;
    `;
    const { rows } = await db.query(query, [userId]);
    return rows[0] || null;
  },

  /** Find exports that are awaiting admin approval */
  async findPendingApprovals(): Promise<ExportJob[]> {
    const { rows } = await db.query(
      `SELECT * FROM export_jobs
       WHERE approval_status = 'pending'
       ORDER BY created_at ASC;`,
    );
    return rows;
  },

  async markDownloaded(id: string): Promise<void> {
    await db.query(
      `UPDATE export_jobs SET downloaded_at = COALESCE(downloaded_at, CURRENT_TIMESTAMP) WHERE id = $1;`,
      [id],
    );
  },

  async findExpiredOlderThan(days: number): Promise<ExportJob[]> {
    const { rows } = await db.query(
      `SELECT * FROM export_jobs WHERE created_at < NOW() - ($1::int * INTERVAL '1 day');`,
      [days],
    );
    return rows;
  },

  async deleteOlderThan(days: number): Promise<number> {
    const { rowCount } = await db.query(
      `DELETE FROM export_jobs WHERE created_at < NOW() - ($1::int * INTERVAL '1 day') RETURNING id;`,
      [days],
    );
    return rowCount || 0;
  },
};
