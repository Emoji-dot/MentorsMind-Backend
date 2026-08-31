import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { asyncHandler } from "../utils/asyncHandler.utils";
import { RecommendationController } from "../controllers/recommendation.controller";

const router = Router();

router.use(authenticate);

/**
 * @swagger
 * /recommendations/mentors:
 *   get:
 *     summary: Get personalised mentor recommendations
 *     tags: [Recommendations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 10
 *           default: 5
 *         description: Number of recommendations to return
 *     responses:
 *       200:
 *         description: List of recommended mentors with scores
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/mentors",
  asyncHandler(RecommendationController.getMentorRecommendations),
);

/**
 * @swagger
 * /recommendations/feedback:
 *   get:
 *     summary: Log a recommendation click or dismiss event
 *     tags: [Recommendations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: event_type
 *         required: true
 *         schema:
 *           type: string
 *           enum: [click, dismiss]
 *       - in: query
 *         name: mentor_id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: position
 *         schema:
 *           type: integer
 *       - in: query
 *         name: reason
 *         schema:
 *           type: string
 *       - in: query
 *         name: session_id
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Feedback logged
 *       400:
 *         description: Invalid parameters
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/feedback",
  asyncHandler(RecommendationController.logFeedback),
);

/**
 * @swagger
 * /recommendations/mentors/{mentorId}/click:
 *   post:
 *     summary: Track a recommendation click (CTR)
 *     tags: [Recommendations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: mentorId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Click tracked
 *       401:
 *         description: Unauthorized
 */
router.post(
  "/mentors/:mentorId/click",
  asyncHandler(RecommendationController.logRecommendationClick),
);

/**
 * @swagger
 * /recommendations/dismiss/{mentorId}:
 *   post:
 *     summary: Dismiss a recommended mentor
 *     tags: [Recommendations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: mentorId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Mentor dismissed
 *       401:
 *         description: Unauthorized
 */
router.post(
  "/dismiss/:mentorId",
  asyncHandler(RecommendationController.dismissMentor),
);

export default router;
