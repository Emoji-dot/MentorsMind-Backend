import { Router } from 'express';
import { FeatureFlagController } from '../controllers/feature-flag.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireAdmin } from '../middleware/rbac.middleware';

const router = Router();

// ── "me" endpoint — GET /api/v1/me/feature-flags ─────────────────────────────
router.get('/me/feature-flags', authenticate, FeatureFlagController.getMyFlags);

// ── Public evaluation (requires auth to identify user) ───────────────────────
router.get('/feature-flags/evaluate/:key', authenticate, FeatureFlagController.evaluate);
router.post('/feature-flags/evaluate/:key/conversion', authenticate, FeatureFlagController.trackConversion);

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

router.use('/admin/feature-flags', adminRouter);

export default router;
