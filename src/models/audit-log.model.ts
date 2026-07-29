import { db } from "../config/database";
import { logger } from "../utils/logger";

export interface AuditLogRecord {
  id: string; // UUID
  level: string;
  action: string;
  message: string;
  user_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, any>;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date;
}

/**
 * Audit Log Model for interacting directly with the PostgreSQL database.
 */
export const AuditLogModel = {
  /**
   * Insert a new audit log record.
   */
  async create(
    log: Omit<AuditLogRecord, "id" | "created_at">,
  ): Promise<AuditLogRecord | null> {
    const query = `
      INSERT INTO audit_logs (
        level, action, message, user_id, entity_type, entity_id, metadata, ip_address, user_agent
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *;
    `;

    // Ensure metadata is a proper JSON string before inserting
    const metadataJson = JSON.stringify(log.metadata || {});

    const values = [
      log.level,
      log.action,
      log.message,
      log.user_id,
      log.entity_type,
      log.entity_id,
      metadataJson,
      log.ip_address,
      log.user_agent,
    ];

    try {
      const { rows } = await db.query(query, values);
      return rows[0] || null;
    } catch (error) {
      // In production, you might not want audit log failures to crash the app,
      // but you should probably log to standard terminal output as fallback.
      logger.error("Failed to insert audit log to DB:", error);
      return null;
    }
  },
  /**
   * Delete audit logs older than the provided number of years.
   * Returns number of records deleted.
   */
  async deleteOlderThanYears(years: number): Promise<number> {
    try {
      const { rowCount } = await db.query(
        `DELETE FROM audit_logs WHERE created_at < NOW() - ($1::int * INTERVAL '1 year') RETURNING id;`,
        [years],
      );

      const deleted = rowCount ?? 0;
      if (deleted > 0) {
        logger.info("AuditLogModel: deleted old audit logs", {
          years,
          deleted,
        });
      }
      return deleted;
    } catch (error) {
      logger.error("Failed to delete old audit logs:", error);
      return 0;
    }
  },
};
