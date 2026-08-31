import crypto from "crypto";
import pool from "../config/database";

export interface ApiKey {
  id: string;
  user_id: string;
  name: string;
  key_prefix: string; // first 8 chars shown to user for identification
  scopes: string[];
  rate_limit: number;
  is_active: boolean;
  description: string | null;
  last_used_at: Date | null;
  expires_at: Date | null;
  created_at: Date;
}

export interface CreateApiKeyPayload {
  userId: string;
  name: string;
  scopes: string[];
  rateLimit?: number;
  description?: string;
  expiresAt?: Date;
}

export interface UsageStats {
  total: number;
  last24h: number;
  last7d: number;
  byStatusClass: { statusClass: string; count: number }[];
  byEndpoint: { endpoint: string; method: string; count: number }[];
}

export interface WebhookSubscription {
  id: string;
  api_key_id: string;
  event: string;
  target_url: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

const PROVIDER = "public";

export const ApiKeyModel = {
  /** Generate a new API key, store hashed, return the plain key (shown once) */
  async create(
    payload: CreateApiKeyPayload,
  ): Promise<{ apiKey: ApiKey; plainKey: string }> {
    const rawKey = `mm_${crypto.randomBytes(24).toString("hex")}`;
    const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
    const keyPrefix = rawKey.slice(0, 10);

    const { rows } = await pool.query<{
      id: string;
      owner_user_id: string;
      name: string;
      scopes: string[];
      rate_limit: number;
      is_active: boolean;
      description: string | null;
      last_used_at: Date | null;
      expires_at: Date | null;
      created_at: Date;
    }>(
      `INSERT INTO integration_api_keys
         (owner_user_id, name, provider, key_hash, scopes, rate_limit, description, expires_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, owner_user_id, name, scopes, rate_limit, is_active, description, last_used_at, expires_at, created_at`,
      [
        payload.userId,
        payload.name,
        PROVIDER,
        keyHash,
        payload.scopes,
        payload.rateLimit ?? 1000,
        payload.description ?? null,
        payload.expiresAt ?? null,
        JSON.stringify({ key_prefix: keyPrefix }),
      ],
    );

    const row = rows[0];
    return {
      plainKey: rawKey,
      apiKey: {
        id: row.id,
        user_id: row.owner_user_id,
        name: row.name,
        key_prefix: keyPrefix,
        scopes: row.scopes,
        rate_limit: row.rate_limit,
        is_active: row.is_active,
        description: row.description,
        last_used_at: row.last_used_at,
        expires_at: row.expires_at,
        created_at: row.created_at,
      },
    };
  },

  async findByUser(userId: string): Promise<ApiKey[]> {
    const { rows } = await pool.query(
      `SELECT id, owner_user_id AS user_id, name, scopes, rate_limit, is_active,
              description, last_used_at, expires_at, created_at,
              metadata->>'key_prefix' AS key_prefix
       FROM integration_api_keys
       WHERE owner_user_id = $1 AND provider = $2
       ORDER BY created_at DESC`,
      [userId, PROVIDER],
    );
    return rows;
  },

  async revoke(id: string, userId: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      `UPDATE integration_api_keys SET is_active = FALSE, updated_at = NOW()
       WHERE id = $1 AND owner_user_id = $2 AND provider = $3`,
      [id, userId, PROVIDER],
    );
    return (rowCount ?? 0) > 0;
  },

  async authenticate(
    rawKey: string,
  ): Promise<{ id: string; userId: string; scopes: string[] } | null> {
    const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
    const { rows } = await pool.query(
      `SELECT id, owner_user_id, scopes, expires_at
       FROM integration_api_keys
       WHERE key_hash = $1 AND provider = $2 AND is_active = TRUE`,
      [keyHash, PROVIDER],
    );
    if (!rows.length) return null;
    const row = rows[0];
    if (row.expires_at && new Date(row.expires_at) <= new Date()) return null;

    await pool.query(
      `UPDATE integration_api_keys SET last_used_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [row.id],
    );
    return { id: row.id, userId: row.owner_user_id, scopes: row.scopes };
  },

  /**
   * Rotate a key's secret in place: keeps the same id/name/scopes/rate_limit,
   * generates a fresh raw key + hash, and returns the new plain key (shown once).
   */
  async rotate(
    id: string,
    userId: string,
  ): Promise<{ apiKey: ApiKey; plainKey: string } | null> {
    const rawKey = `mm_${crypto.randomBytes(24).toString("hex")}`;
    const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
    const keyPrefix = rawKey.slice(0, 10);

    const { rows } = await pool.query<{
      id: string;
      owner_user_id: string;
      name: string;
      scopes: string[];
      rate_limit: number;
      is_active: boolean;
      description: string | null;
      last_used_at: Date | null;
      expires_at: Date | null;
      created_at: Date;
    }>(
      `UPDATE integration_api_keys
       SET key_hash = $1,
           metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
           updated_at = NOW()
       WHERE id = $3 AND owner_user_id = $4 AND provider = $5
       RETURNING id, owner_user_id, name, scopes, rate_limit, is_active, description, last_used_at, expires_at, created_at`,
      [
        keyHash,
        JSON.stringify({ key_prefix: keyPrefix }),
        id,
        userId,
        PROVIDER,
      ],
    );

    if (!rows.length) return null;
    const row = rows[0];
    return {
      plainKey: rawKey,
      apiKey: {
        id: row.id,
        user_id: row.owner_user_id,
        name: row.name,
        key_prefix: keyPrefix,
        scopes: row.scopes,
        rate_limit: row.rate_limit,
        is_active: row.is_active,
        description: row.description,
        last_used_at: row.last_used_at,
        expires_at: row.expires_at,
        created_at: row.created_at,
      },
    };
  },

  /** Verify the key belongs to the user (used before usage/webhook queries) */
  async _assertOwnership(id: string, userId: string): Promise<boolean> {
    const { rows } = await pool.query(
      `SELECT id FROM integration_api_keys WHERE id = $1 AND owner_user_id = $2 AND provider = $3`,
      [id, userId, PROVIDER],
    );
    return rows.length > 0;
  },

  async getUsageStats(
    id: string,
    userId: string,
  ): Promise<UsageStats | null> {
    const owns = await ApiKeyModel._assertOwnership(id, userId);
    if (!owns) return null;

    const [totalsResult, statusResult, endpointResult] = await Promise.all([
      pool.query<{
        total: string;
        last_24h: string;
        last_7d: string;
      }>(
        `SELECT
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') AS last_24h,
           COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') AS last_7d
         FROM api_key_usage_logs
         WHERE api_key_id = $1`,
        [id],
      ),
      pool.query<{ status_class: string; count: string }>(
        `SELECT
           (FLOOR(status_code / 100) || 'xx') AS status_class,
           COUNT(*) AS count
         FROM api_key_usage_logs
         WHERE api_key_id = $1
         GROUP BY status_class
         ORDER BY status_class`,
        [id],
      ),
      pool.query<{ endpoint: string; method: string; count: string }>(
        `SELECT endpoint, method, COUNT(*) AS count
         FROM api_key_usage_logs
         WHERE api_key_id = $1
         GROUP BY endpoint, method
         ORDER BY count DESC
         LIMIT 20`,
        [id],
      ),
    ]);

    const totals = totalsResult.rows[0];
    return {
      total: parseInt(totals?.total ?? "0", 10),
      last24h: parseInt(totals?.last_24h ?? "0", 10),
      last7d: parseInt(totals?.last_7d ?? "0", 10),
      byStatusClass: statusResult.rows.map((r) => ({
        statusClass: r.status_class,
        count: parseInt(r.count, 10),
      })),
      byEndpoint: endpointResult.rows.map((r) => ({
        endpoint: r.endpoint,
        method: r.method,
        count: parseInt(r.count, 10),
      })),
    };
  },

  async createWebhookSubscription(
    apiKeyId: string,
    userId: string,
    event: string,
    targetUrl: string,
  ): Promise<WebhookSubscription | null> {
    const owns = await ApiKeyModel._assertOwnership(apiKeyId, userId);
    if (!owns) return null;

    const { rows } = await pool.query<WebhookSubscription>(
      `INSERT INTO api_key_webhook_subscriptions (api_key_id, event, target_url)
       VALUES ($1, $2, $3)
       RETURNING id, api_key_id, event, target_url, is_active, created_at, updated_at`,
      [apiKeyId, event, targetUrl],
    );
    return rows[0];
  },

  async listWebhookSubscriptions(
    apiKeyId: string,
    userId: string,
  ): Promise<WebhookSubscription[] | null> {
    const owns = await ApiKeyModel._assertOwnership(apiKeyId, userId);
    if (!owns) return null;

    const { rows } = await pool.query<WebhookSubscription>(
      `SELECT id, api_key_id, event, target_url, is_active, created_at, updated_at
       FROM api_key_webhook_subscriptions
       WHERE api_key_id = $1
       ORDER BY created_at DESC`,
      [apiKeyId],
    );
    return rows;
  },

  async deleteWebhookSubscription(
    id: string,
    apiKeyId: string,
    userId: string,
  ): Promise<boolean> {
    const owns = await ApiKeyModel._assertOwnership(apiKeyId, userId);
    if (!owns) return false;

    const { rowCount } = await pool.query(
      `DELETE FROM api_key_webhook_subscriptions WHERE id = $1 AND api_key_id = $2`,
      [id, apiKeyId],
    );
    return (rowCount ?? 0) > 0;
  },
};
