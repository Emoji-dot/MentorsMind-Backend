import { Router } from 'express';
import { FeatureFlagController } from '../controllers/feature-flag.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireAdmin } from '../middleware/rbac.middleware';
import { validate } from '../middleware/validation.middleware';
import {
  flagKeyParamSchema,
  flagIdParamSchema,
  evaluateFlagSchema,
  trackConversionSchema,
  createFeatureFlagSchema,
  updateFeatureFlagSchema,
  getMetricsSchema,
} from '../validators/schemas/feature-flag.schemas';

const router = Router();

// ── "me" endpoint — GET /api/v1/me/feature-flags ─────────────────────────────
router.get('/me/feature-flags', authenticate, FeatureFlagController.getMyFlags);

// ── Public evaluation (requires auth to identify user) ───────────────────────
router.get('/evaluate/:key', authenticate, validate(evaluateFlagSchema), FeatureFlagController.evaluate);
router.post(
  '/evaluate/:key/conversion',
  authenticate,
  validate(trackConversionSchema),
  FeatureFlagController.trackConversion,
);

// ── Admin CRUD — /api/v1/admin/feature-flags ─────────────────────────────────
const adminRouter = Router();
adminRouter.use(authenticate, requireAdmin);
adminRouter.get('/', FeatureFlagController.list);
adminRouter.post('/', FeatureFlagController.create);
adminRouter.get('/key/:key', FeatureFlagController.getByKey);
adminRouter.get('/metrics/:key', FeatureFlagController.getMetrics);
adminRouter.get('/:id', FeatureFlagController.getById);
adminRouter.patch('/:id', FeatureFlagController.update);
adminRouter.put('/:id', FeatureFlagController.update);
adminRouter.delete('/:id', FeatureFlagController.remove);
adminRouter.post('/:id/disable', FeatureFlagController.disable);

router.get('/', FeatureFlagController.list);
router.post('/', validate(createFeatureFlagSchema), FeatureFlagController.create);
router.get('/key/:key', validate(flagKeyParamSchema), FeatureFlagController.getByKey);
router.get('/:id', validate(flagIdParamSchema), FeatureFlagController.getById);
router.put('/:id', validate(updateFeatureFlagSchema), FeatureFlagController.update);
router.delete('/:id', validate(flagIdParamSchema), FeatureFlagController.remove);
router.post('/:id/disable', validate(flagIdParamSchema), FeatureFlagController.disable);
router.get('/metrics/:key', validate(getMetricsSchema), FeatureFlagController.getMetrics);

export default router;
