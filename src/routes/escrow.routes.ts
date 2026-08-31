import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/rbac.middleware";
import { softIdempotency as idempotency } from "../middleware/idempotency.middleware";
import { EscrowController } from "../controllers/escrow.controller";
import { validate } from "../middleware/validation.middleware";
import {
  createEscrowSchema,
  releaseEscrowSchema,
  disputeEscrowSchema,
  resolveDisputeSchema,
  refundEscrowSchema,
  listEscrowsSchema,
  getEscrowByIdSchema,
} from "../validators/schemas/escrow.schemas";

const router = Router();

// All escrow routes require authentication
router.use(authenticate);

// POST /escrow — create escrow (learner only)
router.post(
  "/",
  requireRole("user"),
  validate(createEscrowSchema),
  idempotency,
  EscrowController.createEscrow,
);

// GET /escrow — list user's escrows
router.get("/", validate(listEscrowsSchema), EscrowController.listEscrows);

// GET /escrow/:id — get escrow details
router.get("/:id", validate(getEscrowByIdSchema), EscrowController.getEscrow);

// GET /escrow/:id/status — get escrow status
router.get("/:id/status", validate(getEscrowByIdSchema), EscrowController.getEscrowStatus);

// POST /escrow/:id/release — release funds to mentor (learner or admin)
router.post(
  "/:id/release",
  validate(releaseEscrowSchema),
  idempotency,
  EscrowController.releaseEscrow,
);

// POST /escrow/:id/refund — refund to learner (admin only)
router.post(
  "/:id/refund",
  requireRole("admin"),
  validate(refundEscrowSchema),
  idempotency,
  EscrowController.refundEscrow,
);

// POST /escrow/:id/dispute — open dispute (learner or mentor)
router.post(
  "/:id/dispute",
  validate(disputeEscrowSchema),
  idempotency,
  EscrowController.openDispute,
);

// POST /escrow/:id/resolve — resolve dispute (admin only)
router.post(
  "/:id/resolve",
  requireRole("admin"),
  validate(resolveDisputeSchema),
  idempotency,
  EscrowController.resolveDispute,
);

export default router;
