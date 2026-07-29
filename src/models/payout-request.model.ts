import { db } from "../config/database";

export interface PayoutRequest {
  id: string;
  user_id: string;
  amount: string;
  asset_code: string;
  asset_issuer: string | null;
  destination_address: string;
  status: "pending" | "approved" | "rejected" | "completed" | "failed";
  memo: string | null;
  requested_at: Date;
  processed_at: Date | null;
  transaction_hash: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export const PayoutRequestModel = {
  async create(payoutData: {
    userId: string;
    amount: string;
    assetCode: string;
    assetIssuer?: string;
    destinationAddress: string;
    memo?: string;
  }): Promise<PayoutRequest> {
    const query = `
      INSERT INTO payout_requests (
        user_id, amount, asset_code, asset_issuer, destination_address, memo
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *;
    `;
    const values = [
      payoutData.userId,
      payoutData.amount,
      payoutData.assetCode,
      payoutData.assetIssuer || null,
      payoutData.destinationAddress,
      payoutData.memo || null,
    ];
    const { rows } = await db.query(query, values);
    return rows[0];
  },

  async findByUserId(
    userId: string,
    limit = 50,
    offset = 0,
  ): Promise<PayoutRequest[]> {
    const query = `
      SELECT * FROM payout_requests 
      WHERE user_id = $1 
      ORDER BY requested_at DESC 
      LIMIT $2 OFFSET $3;
    `;
    const { rows } = await db.query(query, [userId, limit, offset]);
    return rows;
  },

  async findById(id: string): Promise<PayoutRequest | null> {
    const query = "SELECT * FROM payout_requests WHERE id = $1;";
    const { rows } = await db.query(query, [id]);
    return rows[0] || null;
  },

  async updateStatus(
    id: string,
    status: PayoutRequest["status"],
    transactionHash?: string,
    notes?: string,
  ): Promise<PayoutRequest | null> {
    const query = `
      UPDATE payout_requests 
      SET status = $2, 
          transaction_hash = COALESCE($3, transaction_hash),
          notes = COALESCE($4, notes),
          processed_at = CASE WHEN $2 IN ('completed', 'failed', 'rejected') THEN NOW() ELSE processed_at END,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *;
    `;
    const { rows } = await db.query(query, [
      id,
      status,
      transactionHash || null,
      notes || null,
    ]);
    return rows[0] || null;
  },

  async findPendingRequests(limit = 50, offset = 0): Promise<PayoutRequest[]> {
    const query = `
      SELECT * FROM payout_requests 
      WHERE status = 'pending' 
      ORDER BY requested_at ASC 
      LIMIT $1 OFFSET $2;
    `;
    const { rows } = await db.query(query, [limit, offset]);
    return rows;
  },

  async getTotalRequestedAmount(
    userId: string,
    assetCode = "XLM",
  ): Promise<string> {
    const query = `
      SELECT COALESCE(SUM(amount), 0) as total
      FROM payout_requests 
      WHERE user_id = $1 AND asset_code = $2 AND status IN ('pending', 'approved');
    `;
    const { rows } = await db.query(query, [userId, assetCode]);
    return rows[0].total;
  },

  async count(): Promise<number> {
    const { rows } = await db.query("SELECT COUNT(*) FROM payout_requests");
    return parseInt(rows[0].count, 10);
  },

  async countByStatus(status: PayoutRequest["status"]): Promise<number> {
    const { rows } = await db.query(
      "SELECT COUNT(*) FROM payout_requests WHERE status = $1",
      [status],
    );
    return parseInt(rows[0].count, 10);
  },
};
