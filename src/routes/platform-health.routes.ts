import { Router, Request, Response } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { requireAdmin } from "../middleware/rbac.middleware";
import { PlatformHealthService } from "../services/platform-health.service";
import { asyncHandler } from "../utils/asyncHandler.utils";

const router = Router();

/**
 * @swagger
 * /platform-health:
 *   get:
 *     summary: Get platform health score
 *     tags: [PlatformHealth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Platform health score with component breakdown
 */
router.get(
  "/",
  authenticate,
  requireAdmin,
  asyncHandler(async (_req: Request, res: Response) => {
    const health = await PlatformHealthService.getHealthScore();
    res.json({ success: true, data: health });
  }),
);

/**
 * @swagger
 * /platform-health/trends:
 *   get:
 *     summary: Get health score trends
 *     tags: [PlatformHealth]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: hours
 *         schema: { type: integer, default: 24 }
 *     responses:
 *       200:
 *         description: Health trends over time
 */
router.get(
  "/trends",
  authenticate,
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const hours = parseInt((req.query.hours as string) ?? "24");
    const trends = await PlatformHealthService.getHealthTrends(hours);
    res.json({ success: true, data: trends });
  }),
);

export default router;
