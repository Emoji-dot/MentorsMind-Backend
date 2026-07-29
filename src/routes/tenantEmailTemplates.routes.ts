import { Router } from "express";
import { TenantEmailTemplatesController } from "../controllers/tenant-email-templates.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireAdmin } from "../middleware/admin-auth.middleware";

const router = Router();

// Admin endpoints for managing tenant email templates
router.post(
  "/",
  authenticate as any,
  requireAdmin as any,
  TenantEmailTemplatesController.createOrUpdate,
);
router.get(
  "/",
  authenticate as any,
  requireAdmin as any,
  TenantEmailTemplatesController.list,
);
router.post(
  "/:name/preview",
  authenticate as any,
  requireAdmin as any,
  TenantEmailTemplatesController.preview,
);
router.post(
  "/:name/rollback",
  authenticate as any,
  requireAdmin as any,
  TenantEmailTemplatesController.rollback,
);

export default router;
