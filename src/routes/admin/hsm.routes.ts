/**
 * HSM Admin Routes
 *
 * Administrative endpoints for the HSM key management service.
 * All endpoints require admin authentication.
 *
 * Routes:
 *   GET  /admin/hsm/status              - Service status and health
 *   GET  /admin/hsm/keys                - List all managed keys (metadata only)
 *   POST /admin/hsm/keys/rotate/:purpose - Rotate a specific key purpose
 *   POST /admin/hsm/keys/rotate-all     - Emergency rotate all keys
 *   POST /admin/hsm/keys/escrow         - Escrow all active keys
 *   GET  /admin/hsm/audit-log           - Retrieve audit log
 *   GET  /admin/hsm/compliance-report   - Generate compliance report
 */

import { Router, type Request, type Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler.utils";
import { authenticate } from "../../middleware/auth.middleware";
import { requireRole } from "../../middleware/rbac.middleware";
import { ResponseUtil } from "../../utils/response.utils";
import { logger } from "../../utils/logger.utils";
import keyManagementService, {
  type ManagedKeyPurpose,
} from "../../services/key-management.service";

const router = Router();

// All HSM routes require authentication + admin role
router.use(authenticate);
router.use(requireRole("admin"));

/**
 * @swagger
 * /admin/hsm/status:
 *   get:
 *     summary: Get HSM key management service status
 *     tags: [HSM]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: HSM service status
 */
router.get(
  "/status",
  asyncHandler(async (_req: Request, res: Response) => {
    const status = await keyManagementService.getStatus();
    ResponseUtil.success(res, status, "HSM status retrieved");
  }),
);

/**
 * @swagger
 * /admin/hsm/keys:
 *   get:
 *     summary: List all managed keys (metadata only, no key material)
 *     tags: [HSM]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of managed keys
 */
router.get(
  "/keys",
  asyncHandler(async (_req: Request, res: Response) => {
    const keys = await keyManagementService.listManagedKeys();
    ResponseUtil.success(res, { keys, count: keys.length }, "Managed keys retrieved");
  }),
);

/**
 * @swagger
 * /admin/hsm/keys/rotate/{purpose}:
 *   post:
 *     summary: Rotate the key for a specific purpose
 *     tags: [HSM]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: purpose
 *         required: true
 *         schema:
 *           type: string
 *           enum: [pii, api-keys, webhook-secrets, oauth-tokens, jwt-signing, document-signing, backup]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reEncrypt:
 *                 type: boolean
 *                 description: Whether to re-encrypt existing data with the new key
 *     responses:
 *       200:
 *         description: Rotation summary
 */
router.post(
  "/keys/rotate/:purpose",
  asyncHandler(async (req: Request, res: Response) => {
    const purpose = req.params.purpose as ManagedKeyPurpose;
    const reEncrypt = req.body?.reEncrypt === true;

    const VALID_PURPOSES: ManagedKeyPurpose[] = [
      "pii",
      "api-keys",
      "webhook-secrets",
      "oauth-tokens",
      "jwt-signing",
      "document-signing",
      "backup",
      "custom",
    ];

    if (!VALID_PURPOSES.includes(purpose)) {
      return ResponseUtil.error(res, `Invalid key purpose: ${purpose}`, 400);
    }

    logger.warn(
      { purpose, reEncrypt, adminId: (req as any).user?.id },
      "Manual key rotation triggered",
    );

    const summary = await keyManagementService.rotatePurposeKey(purpose, reEncrypt);
    ResponseUtil.success(res, summary, "Key rotation complete");
  }),
);

/**
 * @swagger
 * /admin/hsm/keys/rotate-all:
 *   post:
 *     summary: Emergency rotate all active keys
 *     tags: [HSM]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Rotation summaries for all purposes
 */
router.post(
  "/keys/rotate-all",
  asyncHandler(async (req: Request, res: Response) => {
    logger.warn(
      { adminId: (req as any).user?.id },
      "EMERGENCY ALL-KEY ROTATION triggered via API",
    );

    const summaries = await keyManagementService.emergencyRotateAll();
    ResponseUtil.success(
      res,
      { summaries, count: summaries.length },
      "Emergency rotation complete",
    );
  }),
);

/**
 * @swagger
 * /admin/hsm/keys/escrow:
 *   post:
 *     summary: Escrow all active keys (returns shares for distribution to custodians)
 *     tags: [HSM]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Escrow shares (DISTRIBUTE SECURELY)
 */
router.post(
  "/keys/escrow",
  asyncHandler(async (req: Request, res: Response) => {
    logger.warn(
      { adminId: (req as any).user?.id },
      "Key escrow triggered via API — shares generated",
    );

    const shares = await keyManagementService.escrowAllActiveKeys();
    // Return the shares — the caller MUST distribute them to custodians
    ResponseUtil.success(
      res,
      {
        shares,
        warning:
          "Distribute each share to a different custodian immediately. Do not store all shares together.",
      },
      "Keys escrowed",
    );
  }),
);

/**
 * @swagger
 * /admin/hsm/audit-log:
 *   get:
 *     summary: Retrieve HSM audit log
 *     tags: [HSM]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: Audit events
 */
router.get(
  "/audit-log",
  asyncHandler(async (req: Request, res: Response) => {
    const limit = Math.min(parseInt((req.query.limit as string) || "100", 10), 500);
    const offset = parseInt((req.query.offset as string) || "0", 10);

    const hsmSvc = (keyManagementService as any).hsm;
    const { events, total } = await hsmSvc.getAuditLog(limit, offset);
    ResponseUtil.success(
      res,
      { events, total, limit, offset },
      "Audit log retrieved",
    );
  }),
);

/**
 * @swagger
 * /admin/hsm/compliance-report:
 *   get:
 *     summary: Generate FIPS 140-2 compliance report
 *     tags: [HSM]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Compliance report
 */
router.get(
  "/compliance-report",
  asyncHandler(async (req: Request, res: Response) => {
    const from = req.query.from
      ? new Date(req.query.from as string)
      : undefined;
    const to = req.query.to ? new Date(req.query.to as string) : undefined;

    const report = await keyManagementService.generateComplianceReport(from, to);
    ResponseUtil.success(res, report, "Compliance report generated");
  }),
);

export default router;
