import pool from "../config/database";
import { withCurrentTenantFilter } from "../utils/tenant-context.utils";

export interface TransactionRecord {
  id: string;
  tenant_id: string | null;
  user_id: string;
  amount: string;
  currency: string;
  status: "pending" | "completed" | "failed" | "refunded";
  stellar_tx_hash: string | null;
  type: "deposit" | "withdrawal" | "payment";
  created_at: Date;
  updated_at: Date;
}

export const TransactionModel = {
  async findAll(limit = 50, offset = 0): Promise<TransactionRecord[]> {
    const { query, params } = withCurrentTenantFilter(
      `SELECT * FROM transactions`,
      [],
    );
    const nextIdx = params.length + 1;
    const { rows } = await pool.query<TransactionRecord>(
      `${query} ORDER BY created_at DESC LIMIT $${nextIdx} OFFSET $${nextIdx + 1}`,
      [...params, limit, offset],
    );
    return rows;
  },

  async count(): Promise<number> {
    const { query, params } = withCurrentTenantFilter(
      "SELECT COUNT(*) FROM transactions",
      [],
    );
    const { rows } = await pool.query(query, params);
    return parseInt(rows[0].count, 10);
  },

  async getStats(): Promise<{ total_volume: string; count: number }> {
    const { query, params } = withCurrentTenantFilter(
      `SELECT COALESCE(SUM(amount), 0) as total_volume, COUNT(*) as count FROM transactions WHERE status = 'completed'`,
      [],
    );
    const { rows } = await pool.query(query, params);
    return {
      total_volume: rows[0].total_volume,
      count: parseInt(rows[0].count, 10),
    };
  },
};
