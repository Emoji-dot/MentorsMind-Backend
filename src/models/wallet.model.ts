import { db } from "../config/database";
import {
  TenantContext,
  withCurrentTenantFilter,
} from "../utils/tenant-context.utils";

export interface Wallet {
  id: string;
  tenant_id: string | null;
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
    const { query, params } = withCurrentTenantFilter(
      "SELECT * FROM wallets WHERE user_id = $1",
      [userId],
    );
    const { rows } = await db.query(query, params);
    return rows[0] || null;
  },

  async findByUserIds(userIds: string[]): Promise<Wallet[]> {
    if (userIds.length === 0) return [];
    const { query, params } = withCurrentTenantFilter(
      "SELECT * FROM wallets WHERE user_id = ANY($1)",
      [userIds],
    );
    const { rows } = await db.query(query, params);
    return rows;
  },

  async findByStellarPublicKey(
    stellarPublicKey: string,
  ): Promise<Wallet | null> {
    // Stellar public keys are globally unique — no tenant filter needed here,
    // but we still apply one so RLS and app-level checks stay consistent.
    const { query, params } = withCurrentTenantFilter(
      "SELECT * FROM wallets WHERE stellar_public_key = $1",
      [stellarPublicKey],
    );
    const { rows } = await db.query(query, params);
    return rows[0] || null;
  },

  async create(userId: string, stellarPublicKey: string): Promise<Wallet> {
    const tenantId = TenantContext.hasTenantContext()
      ? TenantContext.getTenantId()
      : null;

    const query = `
      INSERT INTO wallets (tenant_id, user_id, stellar_public_key, status)
      VALUES ($1, $2, $3, 'active')
      RETURNING *;
    `;
    const { rows } = await db.query(query, [tenantId, userId, stellarPublicKey]);
    return rows[0];
  },

  async updateStatus(
    userId: string,
    status: "active" | "inactive" | "suspended",
  ): Promise<Wallet | null> {
    const { query, params } = withCurrentTenantFilter(
      `UPDATE wallets SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2`,
      [status, userId],
    );
    const { rows } = await db.query(`${query} RETURNING *`, params);
    return rows[0] || null;
  },

  async updateStellarPublicKey(
    userId: string,
    stellarPublicKey: string,
  ): Promise<Wallet | null> {
    const { query, params } = withCurrentTenantFilter(
      `UPDATE wallets SET stellar_public_key = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2`,
      [stellarPublicKey, userId],
    );
    const { rows } = await db.query(`${query} RETURNING *`, params);
    return rows[0] || null;
  },

  async updateChainAddresses(
    userId: string,
    addresses: {
      ethereumAddress?: string | null;
      polygonAddress?: string | null;
    },
  ): Promise<Wallet | null> {
    const { query, params } = withCurrentTenantFilter(
      `UPDATE wallets
       SET ethereum_address = COALESCE($1, ethereum_address),
           polygon_address = COALESCE($2, polygon_address),
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $3`,
      [addresses.ethereumAddress ?? null, addresses.polygonAddress ?? null, userId],
    );
    const { rows } = await db.query(`${query} RETURNING *`, params);
    return rows[0] || null;
  },

  async delete(userId: string): Promise<boolean> {
    const { query, params } = withCurrentTenantFilter(
      "DELETE FROM wallets WHERE user_id = $1",
      [userId],
    );
    const { rowCount } = await db.query(query, params);
    return (rowCount ?? 0) > 0;
  },

  async findAll(limit = 50, offset = 0): Promise<Wallet[]> {
    const { query, params } = withCurrentTenantFilter(
      `SELECT * FROM wallets`,
      [],
    );
    const nextIdx = params.length + 1;
    const { rows } = await db.query(
      `${query} ORDER BY created_at DESC LIMIT $${nextIdx} OFFSET $${nextIdx + 1}`,
      [...params, limit, offset],
    );
    return rows;
  },

  async count(): Promise<number> {
    const { query, params } = withCurrentTenantFilter(
      "SELECT COUNT(*) FROM wallets",
      [],
    );
    const { rows } = await db.query(query, params);
    return parseInt(rows[0].count, 10);
  },

  async getStats(): Promise<{
    total: number;
    active: number;
    inactive: number;
    suspended: number;
  }> {
    const { query, params } = withCurrentTenantFilter(
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'active') as active,
        COUNT(*) FILTER (WHERE status = 'inactive') as inactive,
        COUNT(*) FILTER (WHERE status = 'suspended') as suspended
       FROM wallets`,
      [],
    );
    const { rows } = await db.query(query, params);
    return {
      total: parseInt(rows[0].total, 10),
      active: parseInt(rows[0].active, 10),
      inactive: parseInt(rows[0].inactive, 10),
      suspended: parseInt(rows[0].suspended, 10),
    };
  },
};
