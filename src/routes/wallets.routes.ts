import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { asyncHandler } from "../utils/asyncHandler.utils";
import { WalletActivationController } from "../controllers/walletActivation.controller";
import { WalletsController } from "../controllers/wallets.controller";

const router = Router();

/**
 * @swagger
 * /wallets/activate:
 *   post:
 *     summary: Activate Stellar wallet
 *     tags: [Wallets]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Wallet activated successfully
 */
router.post(
  "/activate",
  authenticate,
  asyncHandler(WalletActivationController.activate),
);

router.post(
  "/defi/sync",
  authenticate,
  asyncHandler(WalletsController.syncDeFiPositions),
);

router.get(
  "/defi/positions",
  authenticate,
  asyncHandler(WalletsController.getDeFiPositions),
);

export default router;
