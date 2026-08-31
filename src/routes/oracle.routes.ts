import { Router } from "express";
import { OracleController } from "../controllers/oracle.controller";
import { validate } from "../middleware/validation.middleware";
import { getOraclePriceSchema } from "../validators/schemas/oracle.schemas";

const router = Router();

// GET /oracle/price/:asset — public price lookup, no auth required
router.get("/price/:asset", validate(getOraclePriceSchema), OracleController.getPrice);

export default router;
