import { db } from "../config/database";

export interface ExportJob {
  id: string;
  user_id: string;
  status: "pending" | "processing" | "completed" | "failed";
  storage_key: string | null;
  file_path?: string | null; // Alias for storage_key used by download endpoint
  error_message: string | null;
  expires_at: Date | null;
  downloaded_at: Date | null;
  metadata?: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export const ExportJobModel = {
  async create(
    userId: string,
    metadata?: Record<string, any>,
  ): Promise<ExportJob> {
    const query = `
      INSERT INTO export_jobs (user_id, status, metadata)
      VALUES ($1, 'pending', $2)
      RETURNING *;
    `;
    const { rows } = await db.query(query, [
      userId,
      JSON.stringify(metadata || {}),
    ]);
    return rows[0];
  },

  async findById(id: string): Promise<ExportJob | null> {
    const query = "SELECT * FROM export_jobs WHERE id = $1;";
    const { rows } = await db.query(query, [id]);
    return rows[0] || null;
  },

  async getStatus(id: string): Promise<ExportJob | null> {
    const query = "SELECT * FROM export_jobs WHERE id = $1;";
    const { rows } = await db.query(query, [id]);
    return rows[0] || null;
  },

  async updateStatus(
    id: string,
    status: ExportJob["status"],
    storageKey?: string,
    errorMessage?: string,
    expiresAt?: Date,
  ): Promise<void> {
    const query = `
      UPDATE export_jobs
      SET status = $2,
          storage_key = COALESCE($3, storage_key),
          error_message = COALESCE($4, error_message),
          expires_at = COALESCE($5, expires_at),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1;
    `;
    await db.query(query, [id, status, storageKey, errorMessage, expiresAt]);
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
