import { NextFunction, Request, Response, Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.utils";
import { ResponseUtil } from "../utils/response.utils";
import { ZapierController } from "../controllers/zapier.controller";
import { ZapierService } from "../services/zapier.service";
import { validate } from "../middleware/validation.middleware";
import {
  zapierSubscribeSchema,
  zapierUnsubscribeSchema,
  zapierTriggerSampleParamSchema,
  zapierActionSampleParamSchema,
  zapierExecuteActionSchema,
} from "../validators/schemas/integrations.schemas";

interface ZapierRequest extends Request {
  zapier?: Awaited<ReturnType<typeof ZapierService.authenticateApiKey>>;
}

const router = Router();

async function authenticateZapier(
  req: ZapierRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const apiKey = (req.headers["x-api-key"] || req.headers.authorization || "")
    .toString()
    .replace(/^Bearer\s+/i, "");
  const context = await ZapierService.authenticateApiKey(apiKey);

  if (!context) {
    ResponseUtil.unauthorized(res, "Valid integration API key required");
    return;
  }

  req.zapier = context;
  next();
}

router.use("/zapier", asyncHandler(authenticateZapier));
router.get("/zapier/triggers", asyncHandler(ZapierController.listTriggers));
router.post(
  "/zapier/subscribe",
  validate(zapierSubscribeSchema),
  asyncHandler(ZapierController.subscribe),
);
router.delete(
  "/zapier/unsubscribe",
  validate(zapierUnsubscribeSchema),
  asyncHandler(ZapierController.unsubscribe),
);
router.get(
  "/zapier/sample/:trigger",
  validate(zapierTriggerSampleParamSchema),
  asyncHandler(ZapierController.sample),
);
router.get(
  "/zapier/actions/:action/sample",
  validate(zapierActionSampleParamSchema),
  asyncHandler(ZapierController.sampleAction),
);
router.post(
  "/zapier/actions/:action",
  validate(zapierExecuteActionSchema),
  asyncHandler(ZapierController.executeAction),
);

export default router;
