import { Router, Response } from "express";
import {
  authenticate,
  AuthenticatedRequest,
} from "../middleware/auth.middleware";
import { MentorMatchingV2Service } from "../services/mentor-matching-v2.service";
import { asyncHandler } from "../utils/asyncHandler.utils";

const router = Router();

/**
 * @swagger
 * /mentor-matching/matches:
 *   post:
 *     summary: Find mentor matches using multi-dimensional scoring
 *     tags: [MentorMatchingV2]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               skills: { type: array, items: { type: string } }
 *               budget: { type: number }
 *               limit: { type: integer, default: 10 }
 *     responses:
 *       200:
 *         description: Ranked mentor matches with scores and explanations
 */
router.post(
  "/matches",
  authenticate,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { skills, budget, limit } = req.body;
    const matches = await MentorMatchingV2Service.findMatches(
      req.user!.userId,
      { skills, budget, limit },
    );
    res.json({ success: true, data: matches });
  }),
);

/**
 * @swagger
 * /mentor-matching/learning-profile:
 *   get:
 *     summary: Get current user's learning profile
 *     tags: [MentorMatchingV2]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Learning profile
 */
router.get(
  "/learning-profile",
  authenticate,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const profile = await MentorMatchingV2Service.getLearningProfile(
      req.user!.userId,
    );
    res.json({ success: true, data: profile });
  }),
);

/**
 * @swagger
 * /mentor-matching/learning-profile:
 *   put:
 *     summary: Create or update learning profile
 *     tags: [MentorMatchingV2]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [learningStyle, pace, preferredSessionLength, communicationStyle]
 *             properties:
 *               learningStyle: { type: string, enum: [visual, auditory, kinesthetic, reading] }
 *               pace: { type: string, enum: [slow, moderate, fast] }
 *               preferredSessionLength: { type: integer }
 *               communicationStyle: { type: string }
 *     responses:
 *       200:
 *         description: Updated learning profile
 */
router.put(
  "/learning-profile",
  authenticate,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const profile = await MentorMatchingV2Service.saveLearningProfile({
      userId: req.user!.userId,
      ...req.body,
    });
    res.json({ success: true, data: profile });
  }),
);

export default router;
