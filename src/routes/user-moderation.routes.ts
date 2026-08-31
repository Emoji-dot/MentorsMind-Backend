import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.utils";
import { authenticate } from "../middleware/auth.middleware";
import { ModerationController } from "../controllers/moderation.controller";

const router = Router();

// ── All user moderation routes require authentication ─────────────────────────
router.use(authenticate);

/**
 * @swagger
 * /api/v1/user/moderation/flags/{id}/appeal:
 *   post:
 *     summary: Submit an appeal for a rejected flag
 *     tags: [Moderation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason: { type: string }
 */
router.post(
  "/flags/:id/appeal",
  asyncHandler(ModerationController.submitAppeal),
);

/**
 * @swagger
 * /api/v1/moderation/appeals:
 *   post:
 *     summary: Submit an appeal for a rejected flag
 *     tags: [Moderation]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [flagId, reason]
 *             properties:
 *               flagId: { type: string }
 *               reason: { type: string }
 */
router.post(
  "/appeals",
  asyncHandler(async (req, res) => {
    // Alias for POST /flags/:id/appeal using a body-supplied flagId
    (req.params as any).id = req.body.flagId;
    return ModerationController.submitAppeal(req as any, res);
  }),
);

/**
 * @swagger
 * /api/v1/moderation/appeals/my-appeals:
 *   get:
 *     summary: Get appeals submitted by the authenticated user
 *     tags: [Moderation]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  "/appeals/my-appeals",
  asyncHandler(ModerationController.getMyAppeals),
);

export default router;
