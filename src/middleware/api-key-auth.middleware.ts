import { Request, Response, NextFunction } from "express";
import { ApiKeyService } from "../services/api-key.service";
import { RateLimiterService } from "../services/rate-limiter.service";
import { setRateLimitHeaders } from "../utils/rate-limit.utils";
import pool from "../config/database";
import { logger } from "../utils/logger.utils";

const DEFAULT_RATE_LIMIT = 1000;
const RATE_LIMIT_WINDOW_MS = 60_000;

export interface ApiKeyContext {
  id: string;
  userId: string;
  scopes: string[];
}

export interface ApiKeyAuthenticatedRequest extends Request {
  apiKeyContext?: ApiKeyContext;
}

/**
 * Fire-and-forget insert of a usage log row for analytics/monitoring.
 * Never throws into the request lifecycle — logs and swallows errors.
 */
function recordUsage(
  apiKeyId: string,
  endpoint: string,
  method: string,
  statusCode: number,
  ip: string,
): void {
  pool
    .query(
      `INSERT INTO api_key_usage_logs (api_key_id, endpoint, method, status_code, ip_address)
       VALUES ($1, $2, $3, $4, $5)`,
      [apiKeyId, endpoint, method, statusCode, ip],
    )
    .catch((err) => logger.error("Failed to record API key usage log", err));
}

/**
 * Authenticates requests via the `X-API-Key` header, enforces per-key
 * rate limiting (Redis-backed sliding window via RateLimiterService), and
 * records usage analytics for the request once it completes.
 */
export const apiKeyAuth = async (
  req: ApiKeyAuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const rawKey = (req.headers["x-api-key"] || "").toString().trim();

  if (!rawKey) {
    res.status(401).json({
      success: false,
      error: "Missing X-API-Key header",
    });
    return;
  }

  const context = await ApiKeyService.authenticate(rawKey);
  if (!context) {
    res.status(401).json({
      success: false,
      error: "Invalid, revoked, or expired API key",
    });
    return;
  }

  req.apiKeyContext = context;

  // Look up the key's configured rate limit.
  let rateLimit = DEFAULT_RATE_LIMIT;
  try {
    const { rows } = await pool.query<{ rate_limit: number }>(
      `SELECT rate_limit FROM integration_api_keys WHERE id = $1`,
      [context.id],
    );
    if (rows.length && rows[0].rate_limit) {
      rateLimit = rows[0].rate_limit;
    }
  } catch (err) {
    logger.error("Failed to load API key rate limit, using default", err);
  }

  const result = await RateLimiterService.check(
    `apikey:${context.id}`,
    RATE_LIMIT_WINDOW_MS,
    rateLimit,
  );

  setRateLimitHeaders(res, {
    limit: result.limit,
    current: result.current,
    remaining: result.remaining,
    resetTime: result.resetTime,
  });

  if (!result.allowed) {
    res.setHeader(
      "Retry-After",
      Math.ceil((result.resetTime.getTime() - Date.now()) / 1000),
    );
    res.status(429).json({
      success: false,
      error: "API key rate limit exceeded",
      retryAfter: result.resetTime.toISOString(),
    });
    return;
  }

  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown";
  const endpoint = req.originalUrl;
  const method = req.method;

  res.on("finish", () => {
    recordUsage(context.id, endpoint, method, res.statusCode, ip);
  });

  next();
};

/** Middleware factory: 403s if the authenticated API key lacks the given scope. */
export function requireScope(scope: string) {
  return (
    req: ApiKeyAuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ): void => {
    const scopes = req.apiKeyContext?.scopes ?? [];
    if (!scopes.includes(scope)) {
      res.status(403).json({
        success: false,
        error: `Missing required scope: ${scope}`,
      });
      return;
    }
    next();
  };
}
