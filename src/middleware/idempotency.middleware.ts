/**
 * Idempotency Middleware
 *
 * Prevents duplicate mutations on payment/booking/escrow endpoints.
 * Clients send `Idempotency-Key: <uuid>` on POST requests.
 *
 * Behaviour (issue #662):
 *  - Missing header on a payment mutation → 400 (booking mutations fall back
 *    to a SHA-256(userId + requestBody) derived key instead of hard-failing,
 *    since not all booking clients have adopted the header yet).
 *  - Response cached in Redis at idempotency:{userId}:{key} with a 24h TTL.
 *  - Duplicate key → replay the cached response (X-Idempotency-Replayed: true).
 *  - Same key, different endpoint → 409 Conflict.
 *  - Concurrent requests with the same key → second request blocks on a
 *    Redis SETNX lock until the first completes, then returns the cached
 *    result instead of re-running business logic.
 *  - Redis failure → fail open (falls through to next()) rather than block
 *    all traffic; the DB UNIQUE constraint on bookings/transactions remains
 *    the last line of defense against duplicates.
 */

import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { redis } from "../config/redis";
import { logger } from "../utils/logger.utils";

const TTL_SECONDS = 24 * 60 * 60;
const LOCK_TTL_SECONDS = 30;
const LOCK_POLL_MS = 200;
const LOCK_MAX_WAIT_MS = 10_000;

interface CachedResponse {
  status: number;
  endpoint: string;
  body: unknown;
}

function deriveFallbackKey(userId: string, req: Request): string {
  const payload = `${userId}:${JSON.stringify(req.body ?? {})}`;
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function buildEndpointId(req: Request): string {
  return `${req.method} ${req.route?.path ?? req.path}`;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function idempotency(
  options: { requireHeader?: boolean } = {},
) {
  const requireHeader = options.requireHeader ?? false;

  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const headerKey = req.headers["idempotency-key"] as string | undefined;

    if (headerKey && !/^[0-9a-f-]{36}$/i.test(headerKey)) {
      res
        .status(400)
        .json({ success: false, error: "Idempotency-Key must be a valid UUID" });
      return;
    }

    if (!headerKey && requireHeader) {
      res
        .status(400)
        .json({ success: false, error: "Idempotency-Key header is required" });
      return;
    }

    const userId = (req as any).user?.userId ?? (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: "Authentication required" });
      return;
    }

    const idempotencyKey = headerKey ?? deriveFallbackKey(userId, req);
    const endpoint = buildEndpointId(req);
    const cacheKey = `idempotency:${userId}:${idempotencyKey}`;
    const lockKey = `${cacheKey}:lock`;

    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const record: CachedResponse = JSON.parse(cached);
        if (record.endpoint !== endpoint) {
          res.status(409).json({
            success: false,
            error: `Idempotency-Key already used for ${record.endpoint}`,
          });
          return;
        }
        logger.info("Idempotency cache hit", { idempotencyKey, endpoint });
        res.setHeader("X-Idempotency-Replayed", "true");
        res.status(record.status).json(record.body);
        return;
      }

      // Distributed lock so concurrent requests with the same key serialize:
      // the second request waits for the first to finish and returns its
      // cached result rather than re-executing business logic.
      const acquired = await redis.set(lockKey, "1", "EX", LOCK_TTL_SECONDS, "NX");

      if (!acquired) {
        const deadline = Date.now() + LOCK_MAX_WAIT_MS;
        while (Date.now() < deadline) {
          await sleep(LOCK_POLL_MS);
          const nowCached = await redis.get(cacheKey);
          if (nowCached) {
            const record: CachedResponse = JSON.parse(nowCached);
            res.setHeader("X-Idempotency-Replayed", "true");
            res.status(record.status).json(record.body);
            return;
          }
          const lockStillHeld = await redis.get(lockKey);
          if (!lockStillHeld) break;
        }
        // Lock released without a cached result (the first request likely
        // errored) — fall through and let this request process normally.
      }

      const originalJson = res.json.bind(res);
      res.json = (body: unknown) => {
        const status = res.statusCode;
        if (status >= 200 && status < 300) {
          const record: CachedResponse = { status, endpoint, body };
          redis
            .set(cacheKey, JSON.stringify(record), "EX", TTL_SECONDS)
            .catch((err) =>
              logger.warn("Failed to persist idempotency key", {
                err,
                idempotencyKey,
              }),
            );
        }
        redis.del(lockKey).catch(() => undefined);
        return originalJson(body);
      };

      res.on("close", () => {
        if (!res.writableEnded) {
          redis.del(lockKey).catch(() => undefined);
        }
      });

      next();
    } catch (err) {
      logger.warn("Idempotency middleware error — failing open", { err });
      next();
    }
  };
}

/** Default export: header required (payment/booking mutation endpoints). */
export const requireIdempotency = idempotency({ requireHeader: true });
/** Header optional, falls back to a content-derived key. */
export const softIdempotency = idempotency({ requireHeader: false });
