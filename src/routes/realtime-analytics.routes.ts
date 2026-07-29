/**
 * Realtime Analytics Routes — Issue #749
 *
 * Exposes near-real-time analytics endpoints that bypass materialized views
 * and query base tables directly, providing data with < 2-minute latency
 * (compared to the 15-minute materialized-view refresh cycle).
 *
 * All routes require authentication. Admin-scoped routes additionally require
 * the requireAdmin middleware.
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireAdmin } from '../middleware/admin-auth.middleware';
import { asyncHandler } from '../utils/asyncHandler.utils';
import { RealtimeAnalyticsService } from '../services/realtime-analytics.service';
import { ResponseUtil } from '../utils/response.utils';

const router = Router();

// All realtime analytics routes require authentication
router.use(authenticate);

/**
 * @openapi
 * /analytics/realtime/dashboard:
 *   get:
 *     summary: Get near-real-time analytics dashboard
 *     description: |
 *       Returns a full analytics dashboard snapshot computed directly from
 *       base tables, bypassing the 15-minute materialized view refresh cycle.
 *       Data latency is at most 2 minutes (Redis cache TTL).
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: window
 *         schema:
 *           type: integer
 *           default: 15
 *         description: Time window in minutes to aggregate data over
 *     responses:
 *       200:
 *         description: Realtime dashboard data
 */
router.get(
  '/realtime/dashboard',
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const window = parseInt((req.query.window as string) || '15', 10);
    const windowMinutes = isNaN(window) || window < 1 ? 15 : Math.min(window, 1440);
    const data = await RealtimeAnalyticsService.getRealtimeDashboard(windowMinutes);
    ResponseUtil.success(res, data);
  }),
);

/**
 * @openapi
 * /analytics/realtime/revenue:
 *   get:
 *     summary: Get near-real-time revenue metrics
 *     description: |
 *       Returns revenue aggregates from the last N minutes, queried directly
 *       from the transactions table. Suitable for financial dashboards that
 *       require operational-level latency.
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: window
 *         schema:
 *           type: integer
 *           default: 15
 *         description: Time window in minutes
 *     responses:
 *       200:
 *         description: Realtime revenue metrics
 */
router.get(
  '/realtime/revenue',
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const window = parseInt((req.query.window as string) || '15', 10);
    const windowMinutes = isNaN(window) || window < 1 ? 15 : Math.min(window, 1440);
    const data = await RealtimeAnalyticsService.getRealtimeRevenue(windowMinutes);
    ResponseUtil.success(res, data);
  }),
);

/**
 * @openapi
 * /analytics/realtime/sessions:
 *   get:
 *     summary: Get near-real-time session statistics
 *     description: |
 *       Returns booking/session counts from the last N minutes, queried
 *       directly from the bookings table.
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: window
 *         schema:
 *           type: integer
 *           default: 15
 *         description: Time window in minutes
 *     responses:
 *       200:
 *         description: Realtime session stats
 */
router.get(
  '/realtime/sessions',
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const window = parseInt((req.query.window as string) || '15', 10);
    const windowMinutes = isNaN(window) || window < 1 ? 15 : Math.min(window, 1440);
    const data = await RealtimeAnalyticsService.getRealtimeSessionStats(windowMinutes);
    ResponseUtil.success(res, data);
  }),
);

/**
 * @openapi
 * /analytics/realtime/users:
 *   get:
 *     summary: Get near-real-time user growth metrics
 *     description: Returns new user registration counts for the last N minutes.
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: window
 *         schema:
 *           type: integer
 *           default: 15
 *     responses:
 *       200:
 *         description: Realtime user growth stats
 */
router.get(
  '/realtime/users',
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const window = parseInt((req.query.window as string) || '15', 10);
    const windowMinutes = isNaN(window) || window < 1 ? 15 : Math.min(window, 1440);
    const data = await RealtimeAnalyticsService.getRealtimeUserGrowth(windowMinutes);
    ResponseUtil.success(res, data);
  }),
);

/**
 * @openapi
 * /analytics/realtime/top-mentors:
 *   get:
 *     summary: Get top-performing mentors in the last N minutes
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: window
 *         schema:
 *           type: integer
 *           default: 60
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: Top mentors ranked by session count
 */
router.get(
  '/realtime/top-mentors',
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const window = parseInt((req.query.window as string) || '60', 10);
    const limit = parseInt((req.query.limit as string) || '10', 10);
    const windowMinutes = isNaN(window) || window < 1 ? 60 : Math.min(window, 1440);
    const safeLimit = isNaN(limit) || limit < 1 ? 10 : Math.min(limit, 50);
    const data = await RealtimeAnalyticsService.getTopMentorsRealtime(windowMinutes, safeLimit);
    ResponseUtil.success(res, data);
  }),
);

export default router;
