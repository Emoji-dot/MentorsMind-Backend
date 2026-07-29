import { Router } from "express";
import { DisputesController } from "../controllers/disputes.controller";
import { validate } from "../middleware/validation.middleware";
import {
  disputeIdParamSchema,
  openDisputeSchema,
  uploadEvidenceSchema,
  resolveDisputeSchema,
  mediateDisputeSchema,
} from "../validators/schemas/disputes.schemas";

const router = Router();

// Middleware placeholder for authentication (assume it's attached where this router is mounted)

// User/Admin routes
router.get("/templates/resolution", DisputesController.getResolutionTemplates);
router.get("/", DisputesController.listDisputes);
router.post("/", validate(openDisputeSchema), DisputesController.openDispute);
router.get("/:id", validate(disputeIdParamSchema), DisputesController.getDispute);
router.post(
  "/:id/evidence",
  validate(uploadEvidenceSchema),
  DisputesController.uploadEvidence,
);

// Admin-only routes
router.post(
  "/:id/resolve",
  validate(resolveDisputeSchema),
  DisputesController.resolveDispute,
);
router.post(
  "/:id/mediate",
  validate(mediateDisputeSchema),
  DisputesController.mediateDispute,
);

export default router;
