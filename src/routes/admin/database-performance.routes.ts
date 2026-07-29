/**
 * database-performance.routes.ts
 *
 * Admin routes for database query performance monitoring (issue #742).
 * Mounted under /api/v1/admin/database
 *
 * All routes require authentication + admin role (applied in admin.routes.ts).
 */

import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler.utils";
import { DatabasePerformanceController } from "../../controllers/database-performance.controller";

const router = Router();

/**
 * @swagger
 * /admin/database/slow-queries:
 *   get:
 *     summary: Retrieve slow query log
 *     tags: [Admin, Database Performance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: threshold
 *         schema:
 *           type: integer
 *           default: 500
 *         description: Minimum execution time threshold in milliseconds
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *         description: Maximum number of records to return
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [frequency, max_time]
 *           default: max_time
 *         description: Sort order
 *     responses:
 *       200:
 *         description: Slow query log with percentile data
 *       403:
 *         description: Admin role required
 */
router.get(
  "/slow-queries",
  asyncHandler(DatabasePerformanceController.getSlowQueries),
);

/**
 * @swagger
 * /admin/database/index-recommendations:
 *   get:
 *     summary: Get automated index recommendations
 *     tags: [Admin, Database Performance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Number of recent slow-query plans to analyse
 *     responses:
 *       200:
 *         description: List of CREATE INDEX suggestions
 *       403:
 *         description: Admin role required
 */
router.get(
  "/index-recommendations",
  asyncHandler(DatabasePerformanceController.getIndexRecommendations),
);

export default router;
