import { db } from "../config/database";

export interface Wallet {
  id: string;
  user_id: string;
  stellar_public_key: string;
  ethereum_address?: string | null;
  polygon_address?: string | null;
  status: "active" | "inactive" | "suspended";
  wallet_activated?: boolean;
  created_at: Date;
  updated_at: Date;
}

export const WalletModel = {
  async findByUserId(userId: string): Promise<Wallet | null> {
    const query = "SELECT * FROM wallets WHERE user_id = $1;";
    const { rows } = await db.query(query, [userId]);
    return rows[0] || null;
  },

  async findByUserIds(userIds: string[]): Promise<Wallet[]> {
    if (userIds.length === 0) return [];
    const query = "SELECT * FROM wallets WHERE user_id = ANY($1);";
    const { rows } = await db.query(query, [userIds]);
    return rows;
  },

  async findByStellarPublicKey(
    stellarPublicKey: string,
  ): Promise<Wallet | null> {
    const query = "SELECT * FROM wallets WHERE stellar_public_key = $1;";
    const { rows } = await db.query(query, [stellarPublicKey]);
    return rows[0] || null;
  },

  async create(userId: string, stellarPublicKey: string): Promise<Wallet> {
    const query = `
      INSERT INTO wallets (user_id, stellar_public_key, status)
      VALUES ($1, $2, 'active')
      RETURNING *;
    `;
    const { rows } = await db.query(query, [userId, stellarPublicKey]);
    return rows[0];
  },

  async updateStatus(
    userId: string,
    status: "active" | "inactive" | "suspended",
  ): Promise<Wallet | null> {
    const query = `
      UPDATE wallets 
      SET status = $2, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
      RETURNING *;
    `;
    const { rows } = await db.query(query, [userId, status]);
    return rows[0] || null;
  },

  async updateStellarPublicKey(
    userId: string,
    stellarPublicKey: string,
  ): Promise<Wallet | null> {
    const query = `
      UPDATE wallets 
      SET stellar_public_key = $2, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
      RETURNING *;
    `;
    const { rows } = await db.query(query, [userId, stellarPublicKey]);
    return rows[0] || null;
  },

  async updateChainAddresses(
    userId: string,
    addresses: {
      ethereumAddress?: string | null;
      polygonAddress?: string | null;
    },
  ): Promise<Wallet | null> {
    const query = `
      UPDATE wallets
      SET ethereum_address = COALESCE($2, ethereum_address),
          polygon_address = COALESCE($3, polygon_address),
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
      RETURNING *;
    `;
    const { rows } = await db.query(query, [
      userId,
      addresses.ethereumAddress ?? null,
      addresses.polygonAddress ?? null,
    ]);
    return rows[0] || null;
  },

  async delete(userId: string): Promise<boolean> {
    const query = "DELETE FROM wallets WHERE user_id = $1;";
    const { rowCount } = await db.query(query, [userId]);
    return (rowCount ?? 0) > 0;
  },

  async findAll(limit = 50, offset = 0): Promise<Wallet[]> {
    const query = `
      SELECT * FROM wallets 
      ORDER BY created_at DESC 
      LIMIT $1 OFFSET $2;
    `;
    const { rows } = await db.query(query, [limit, offset]);
    return rows;
  },

  async count(): Promise<number> {
    const { rows } = await db.query("SELECT COUNT(*) FROM wallets");
    return parseInt(rows[0].count, 10);
  },

  async getStats(): Promise<{
    total: number;
    active: number;
    inactive: number;
    suspended: number;
  }> {
    const query = `
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'active') as active,
        COUNT(*) FILTER (WHERE status = 'inactive') as inactive,
        COUNT(*) FILTER (WHERE status = 'suspended') as suspended
      FROM wallets;
    `;
    const { rows } = await db.query(query);
    return {
      total: parseInt(rows[0].total, 10),
      active: parseInt(rows[0].active, 10),
      inactive: parseInt(rows[0].inactive, 10),
      suspended: parseInt(rows[0].suspended, 10),
    };
  },
};
