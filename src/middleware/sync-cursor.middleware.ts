import { Request, Response, NextFunction } from 'express';
import pool from '../config/database';
import { logger } from '../utils/logger.utils';

/**
 * Attaches X-Sync-Cursor to mutating responses so offline-first mobile clients
 * can track server state without a dedicated round-trip (issue #689).
 *
 * Must run AFTER `authenticate` in the middleware chain (needs req.user) and
 * BEFORE the route handler, so the header is set before any response body is
 * written. The value reflects the cursor as of request start; for endpoints
 * that write to sync_changes as part of the request (POST /sync), the sync
 * controller sets a more precise post-write value itself, which overrides this.
 */
export function syncCursorMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD') {
    next();
    return;
  }

  const userId = (req as Request & { user?: { userId?: string; id?: string } }).user?.userId
    ?? (req as Request & { user?: { userId?: string; id?: string } }).user?.id;

  if (!userId) {
    next();
    return;
  }

  pool
    .query(`SELECT COALESCE(MAX(cursor), 0)::bigint AS cursor FROM sync_changes WHERE user_id = $1`, [userId])
    .then(({ rows }) => {
      res.setHeader('X-Sync-Cursor', String(rows[0]?.cursor ?? 0));
    })
    .catch((err) => {
      logger.error({ err }, 'syncCursorMiddleware: failed to compute cursor');
    })
    .finally(() => next());
}
