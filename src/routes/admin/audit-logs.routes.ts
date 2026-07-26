/**
 * Admin Audit Log Routes
 *
 * All routes are restricted to authenticated admin users.
 *
 * Endpoints:
 *   GET  /api/v1/admin/audit-logs                  - Paginated audit log list
 *   GET  /api/v1/admin/audit-logs/verify-chain     - Verify hash chain integrity
 *   GET  /api/v1/admin/audit-logs/export           - Export logs as CSV
 *   GET  /api/v1/admin/audit-logs/stats            - Aggregate statistics
 */

import { Router } from "express";
import { AdminAuditController } from "../../controllers/admin-audit.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { requireRole } from "../../middleware/rbac.middleware";
import { asyncHandler } from "../../utils/asyncHandler.utils";

const router = Router();

// All audit log admin routes require authentication and admin role
router.use(authenticate, requireRole("admin"));

/**
 * @swagger
 * /api/v1/admin/audit-logs:
 *   get:
 *     summary: List audit log entries (admin)
 *     tags: [Admin, Audit]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: userId
 *         schema: { type: string }
 *       - in: query
 *         name: action
 *         schema: { type: string }
 *       - in: query
 *         name: resourceType
 *         schema: { type: string }
 *       - in: query
 *         name: startDate
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: endDate
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50, maximum: 200 }
 *     responses:
 *       200:
 *         description: Audit logs retrieved
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — admin role required
 */
router.get("/", asyncHandler(AdminAuditController.listAuditLogs));

/**
 * @swagger
 * /api/v1/admin/audit-logs/verify-chain:
 *   get:
 *     summary: Verify audit log hash chain integrity
 *     description: |
 *       Checks that every audit log entry's HMAC-SHA256 hash is valid and
 *       that the previous_hash chain is unbroken.
 *       Returns errors for any entries that show signs of tampering.
 *     tags: [Admin, Audit]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         description: Number of records to verify (default 1000, max 50000)
 *         schema: { type: integer, default: 1000 }
 *     responses:
 *       200:
 *         description: Chain verification result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 valid:
 *                   type: boolean
 *                 errors:
 *                   type: array
 *                   items: { type: string }
 *                 checkedCount:
 *                   type: integer
 *                 verifiedAt:
 *                   type: string
 *                   format: date-time
 */
router.get("/verify-chain", asyncHandler(AdminAuditController.verifyChain));

/**
 * @swagger
 * /api/v1/admin/audit-logs/export:
 *   get:
 *     summary: Export audit logs as CSV
 *     tags: [Admin, Audit]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: userId
 *         schema: { type: string }
 *       - in: query
 *         name: action
 *         schema: { type: string }
 *       - in: query
 *         name: resourceType
 *         schema: { type: string }
 *       - in: query
 *         name: startDate
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: endDate
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: CSV file download
 *         content:
 *           text/csv:
 *             schema:
 *               type: string
 */
router.get("/export", asyncHandler(AdminAuditController.exportCsv));

/**
 * @swagger
 * /api/v1/admin/audit-logs/stats:
 *   get:
 *     summary: Audit log aggregate statistics
 *     tags: [Admin, Audit]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: endDate
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: Statistics retrieved
 */
router.get("/stats", asyncHandler(AdminAuditController.getStats));

export default router;
