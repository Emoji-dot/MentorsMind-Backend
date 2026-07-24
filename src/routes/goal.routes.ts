import { Router } from 'express';
import { GoalController } from '../controllers/goal.controller';
import { authenticate } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import {
  createGoalSchema,
  goalIdParamSchema,
  updateGoalSchema,
  updateGoalProgressSchema,
  linkSessionSchema,
} from '../validators/schemas/goal.schemas';

const router = Router();

// Apply authentication to all goal routes
router.use(authenticate as any);

/**
 * @swagger
 * /api/v1/goals:
 *   post:
 *     summary: Create a new learning goal
 *     tags: [Goals]
 *     security: [{ bearerAuth: [] }]
 */
router.post('/', validate(createGoalSchema), GoalController.create);

/**
 * @swagger
 * /api/v1/goals:
 *   get:
 *     summary: List user's goals
 *     tags: [Goals]
 *     security: [{ bearerAuth: [] }]
 */
router.get('/', GoalController.list);

/**
 * @swagger
 * /api/v1/goals/{id}:
 *   get:
 *     summary: Get specific goal
 *     tags: [Goals]
 */
router.get('/:id', validate(goalIdParamSchema), GoalController.get);

/**
 * @swagger
 * /api/v1/goals/{id}:
 *   put:
 *     summary: Update goal title, description, or target_date
 *     tags: [Goals]
 */
router.put('/:id', validate(updateGoalSchema), GoalController.update);

/**
 * @swagger
 * /api/v1/goals/{id}:
 *   delete:
 *     summary: Delete goal
 *     tags: [Goals]
 */
router.delete('/:id', validate(goalIdParamSchema), GoalController.delete);

/**
 * @swagger
 * /api/v1/goals/{id}/progress:
 *   post:
 *     summary: Log goal progress history
 *     tags: [Goals]
 *     security: [{ bearerAuth: [] }]
 */
router.post('/:id/progress', validate(updateGoalProgressSchema), GoalController.updateProgress);

/**
 * @swagger
 * /api/v1/goals/{id}/progress:
 *   get:
 *     summary: View goal progress history
 *     tags: [Goals]
 *     security: [{ bearerAuth: [] }]
 */
router.get('/:id/progress', validate(goalIdParamSchema), GoalController.getProgress);

/**
 * @swagger
 * /api/v1/goals/{id}/link-session:
 *   post:
 *     summary: Link session (booking) to goal
 *     tags: [Goals]
 */
router.post('/:id/link-session', validate(linkSessionSchema), GoalController.linkSession);

export default router;
