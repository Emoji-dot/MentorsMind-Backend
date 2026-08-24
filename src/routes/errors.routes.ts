import { Router } from 'express';
import { getErrorCatalog } from '../controllers/error-catalog.controller';

const router = Router();

router.get('/catalog', getErrorCatalog);

export default router;
