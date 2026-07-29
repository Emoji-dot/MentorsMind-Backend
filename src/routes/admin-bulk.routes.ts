import { Router } from "express";
import { BulkProgressController } from "../controllers/bulk-progress.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireAdmin } from "../middleware/admin-auth.middleware";
import { asyncHandler } from "../utils/asyncHandler.utils";

const router = Router();

router.use(authenticate, requireAdmin);

router.get("/:jobId/status", asyncHandler(BulkProgressController.getStatus));
router.delete("/:jobId", asyncHandler(BulkProgressController.deleteJob));

export default router;
