import { Router, Response } from "express";
import {
  authenticate,
  AuthenticatedRequest,
} from "../middleware/auth.middleware";
import { LoyaltyService } from "../services/loyalty.service";
import { asyncHandler } from "../utils/asyncHandler.utils";
import { validate } from "../middleware/validation.middleware";
import {
  earnTokensSchema,
  redeemTokensSchema,
} from "../validators/schemas/loyalty.schemas";

const router = Router();

/**
 * @swagger
 * /loyalty/token:
 *   get:
 *     summary: Get loyalty token info
 *     tags: [Loyalty]
 *     responses:
 *       200:
 *         description: Token info
 */
router.get(
  "/token",
  asyncHandler(async (_req, res: Response) => {
    const info = await LoyaltyService.getTokenInfo();
    res.json({ success: true, data: info });
  }),
);

/**
 * @swagger
 * /loyalty/rules:
 *   get:
 *     summary: Get earn rules
 *     tags: [Loyalty]
 *     responses:
 *       200:
 *         description: Earn rules
 */
router.get(
  "/rules",
  asyncHandler(async (_req, res: Response) => {
    const rules = await LoyaltyService.getEarnRules();
    res.json({ success: true, data: rules });
  }),
);

/**
 * @swagger
 * /loyalty/account:
 *   get:
 *     summary: Get current user's loyalty account
 *     tags: [Loyalty]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Loyalty account
 */
router.get(
  "/account",
  authenticate,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const account = await LoyaltyService.getOrCreateAccount(req.user!.userId);
    res.json({ success: true, data: account });
  }),
);

/**
 * @swagger
 * /loyalty/status:
 *   get:
 *     summary: Get current user's loyalty status (points, tier, next tier, discount)
 *     tags: [Loyalty]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Loyalty status
 */
router.get(
  "/status",
  authenticate,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const status = await LoyaltyService.getStatus(req.user!.userId);
    res.json({ success: true, data: status });
  }),
);

/**
 * @swagger
 * /loyalty/earn:
 *   post:
 *     summary: Earn loyalty tokens for an action
 *     tags: [Loyalty]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [action]
 *             properties:
 *               action: { type: string }
 *     responses:
 *       200:
 *         description: Updated account
 */
router.post(
  "/earn",
  authenticate,
  validate(earnTokensSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { action } = req.body;
    const account = await LoyaltyService.earnTokens(req.user!.userId, action);
    res.json({ success: true, data: account });
  }),
);

/**
 * @swagger
 * /loyalty/redeem:
 *   post:
 *     summary: Redeem loyalty tokens
 *     tags: [Loyalty]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [tokens]
 *             properties:
 *               tokens: { type: number }
 *     responses:
 *       200:
 *         description: Updated account
 */
router.post(
  "/redeem",
  authenticate,
  validate(redeemTokensSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { tokens } = req.body;
    const account = await LoyaltyService.redeemTokens(
      req.user!.userId,
      Number(tokens),
    );
    res.json({ success: true, data: account });
  }),
);

/**
 * @swagger
 * /loyalty/transactions:
 *   get:
 *     summary: Get loyalty transaction history
 *     tags: [Loyalty]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Transaction history
 */
router.get(
  "/transactions",
  authenticate,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const history = await LoyaltyService.getTransactionHistory(
      req.user!.userId,
    );
    res.json({ success: true, data: history });
  }),
);

export default router;
