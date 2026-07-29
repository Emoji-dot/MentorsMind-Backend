/**
 * Consent Routes
 *
 * GDPR Article 7 — granular, freely-given consent for each processing purpose.
 *
 * Routes:
 *   POST   /api/v1/consent           — Record all consent choices
 *   GET    /api/v1/consent           — Get current (latest) consent
 *   PUT    /api/v1/consent           — Update consent (append-only)
 *   POST   /api/v1/consent/withdraw  — Withdraw all consent
 *   GET    /api/v1/consent/history   — Full consent history (audit trail)
 *   GET    /api/v1/consent/stats     — Aggregate stats (admin only)
 */

import { Router } from "express";
import { ConsentController } from "../controllers/consent.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/rbac.middleware";
import { asyncHandler } from "../utils/asyncHandler.utils";

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Consent
 *   description: GDPR granular consent management
 */

/**
 * @swagger
 * /api/v1/consent:
 *   post:
 *     summary: Record granular consent choices
 *     description: |
 *       Records the user's consent for each distinct data processing purpose
 *       as required by GDPR Article 7. Each field must be individually set.
 *       Records are append-only — a new record is created on each change.
 *     tags: [Consent]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - analytics_consent
 *               - marketing_consent
 *               - functional_consent
 *               - session_recording_consent
 *               - ai_analysis_consent
 *               - data_sharing_consent
 *             properties:
 *               analytics_consent:
 *                 type: boolean
 *                 description: Consent for analytics and usage tracking
 *               marketing_consent:
 *                 type: boolean
 *                 description: Consent for marketing emails and promotions
 *               functional_consent:
 *                 type: boolean
 *                 description: Consent for functional cookies and preferences
 *               session_recording_consent:
 *                 type: boolean
 *                 description: Consent for video/audio session recording
 *               ai_analysis_consent:
 *                 type: boolean
 *                 description: Consent for AI analysis of session content (summaries, insights)
 *               data_sharing_consent:
 *                 type: boolean
 *                 description: Consent for sharing anonymised data with third parties
 *               consent_version:
 *                 type: string
 *                 description: Version of the consent policy (default "1.0")
 *     responses:
 *       201:
 *         description: Consent record created successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.post("/", authenticate, asyncHandler(ConsentController.recordConsent));

/**
 * @swagger
 * /api/v1/consent:
 *   get:
 *     summary: Get current consent record
 *     description: Returns the most recent consent record for the authenticated user.
 *     tags: [Consent]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current consent choices
 *       401:
 *         description: Unauthorized
 */
router.get("/", authenticate, asyncHandler(ConsentController.getConsent));

/**
 * @swagger
 * /api/v1/consent:
 *   put:
 *     summary: Update consent preferences (append-only)
 *     description: Creates a new consent record with updated preferences. Records are never updated in-place.
 *     tags: [Consent]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ConsentFields'
 *     responses:
 *       201:
 *         description: Consent record updated (new record created)
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.put("/", authenticate, asyncHandler(ConsentController.updateConsent));

/**
 * @swagger
 * /api/v1/consent/withdraw:
 *   post:
 *     summary: Withdraw all consent
 *     description: |
 *       Withdraws all consent by inserting a new record with all fields set
 *       to false and a withdrawn_at timestamp. Includes an optional reason.
 *       GDPR right to withdraw consent (Article 7(3)).
 *     tags: [Consent]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               withdrawal_reason:
 *                 type: string
 *                 maxLength: 1000
 *                 description: Optional reason for withdrawing consent
 *     responses:
 *       201:
 *         description: Consent withdrawn successfully
 *       401:
 *         description: Unauthorized
 */
router.post(
  "/withdraw",
  authenticate,
  asyncHandler(ConsentController.withdrawConsent),
);

/**
 * @swagger
 * /api/v1/consent/history:
 *   get:
 *     summary: Get full consent history
 *     description: |
 *       Returns a paginated audit trail of all consent changes for the user.
 *       Required for GDPR compliance — users have the right to see all their
 *       consent decisions.
 *     tags: [Consent]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *     responses:
 *       200:
 *         description: Consent history
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/history",
  authenticate,
  asyncHandler(ConsentController.getConsentHistory),
);

/**
 * @swagger
 * /api/v1/consent/stats:
 *   get:
 *     summary: Aggregate consent statistics (admin)
 *     tags: [Consent, Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Consent statistics for all six processing purposes
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — admin role required
 */
router.get(
  "/stats",
  authenticate,
  requireRole("admin"),
  asyncHandler(ConsentController.getConsentStats),
);

export default router;
