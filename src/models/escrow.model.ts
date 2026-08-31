import { db } from "../config/database";

export type EscrowStatus =
  | "pending"
  | "funded"
  | "released"
  | "disputed"
  | "resolved"
  | "refunded"
  | "cancelled";

export interface EscrowRecord {
  id: string;
  learner_id: string;
  mentor_id: string;
  amount: string;
  currency: string;
  status: EscrowStatus;
  stellar_tx_hash: string | null;
  dispute_id: string | null;
  description: string | null;
  created_at: Date;
  updated_at: Date;
  released_at: Date | null;
  refunded_at: Date | null;
}

export const EscrowModel = {
  async create(data: {
    learnerId: string;
    mentorId: string;
    amount: string;
    currency: string;
    description?: string;
  }): Promise<EscrowRecord> {
    const { rows } = await db.query(
      `INSERT INTO escrows (learner_id, mentor_id, amount, currency, description, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING *`,
      [
        data.learnerId,
        data.mentorId,
        data.amount,
        data.currency,
        data.description || null,
      ],
    );
    return rows[0];
  },

  async findById(id: string): Promise<EscrowRecord | null> {
    const { rows } = await db.query(`SELECT * FROM escrows WHERE id = $1`, [
      id,
    ]);
    return rows[0] || null;
  },

  async findByUserId(
    userId: string,
    limit = 50,
    offset = 0,
  ): Promise<EscrowRecord[]> {
    const { rows } = await db.query(
      `SELECT * FROM escrows 
       WHERE learner_id = $1 OR mentor_id = $1
       ORDER BY created_at DESC 
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );
    return rows;
  },

  async updateStatus(
    id: string,
    status: EscrowStatus,
    additionalFields?: Partial<
      Pick<
        EscrowRecord,
        "stellar_tx_hash" | "dispute_id" | "released_at" | "refunded_at"
      >
    >,
  ): Promise<EscrowRecord | null> {
    const fields: string[] = ["status = $2", "updated_at = NOW()"];
    const values: any[] = [id, status];
    let paramIndex = 3;

    if (additionalFields?.stellar_tx_hash !== undefined) {
      fields.push(`stellar_tx_hash = $${paramIndex++}`);
      values.push(additionalFields.stellar_tx_hash);
    }
    if (additionalFields?.dispute_id !== undefined) {
      fields.push(`dispute_id = $${paramIndex++}`);
      values.push(additionalFields.dispute_id);
    }
    if (additionalFields?.released_at !== undefined) {
      fields.push(`released_at = $${paramIndex++}`);
      values.push(additionalFields.released_at);
    }
    if (additionalFields?.refunded_at !== undefined) {
      fields.push(`refunded_at = $${paramIndex++}`);
      values.push(additionalFields.refunded_at);
    }

    const { rows } = await db.query(
      `UPDATE escrows SET ${fields.join(", ")} WHERE id = $1 RETURNING *`,
      values,
    );
    return rows[0] || null;
  },

  async countByStatus(status: EscrowStatus): Promise<number> {
    const { rows } = await db.query(
      `SELECT COUNT(*) FROM escrows WHERE status = $1`,
      [status],
    );
    return parseInt(rows[0].count, 10);
  },

  async getTotalVolume(): Promise<{ total_volume: string; count: number }> {
    const { rows } = await db.query(
      `SELECT COALESCE(SUM(amount), 0) as total_volume, COUNT(*) as count 
       FROM escrows WHERE status IN ('released', 'completed')`,
    );
    return {
      total_volume: rows[0].total_volume,
      count: parseInt(rows[0].count, 10),
    };
  },
};
