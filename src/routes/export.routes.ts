import { Router } from "express";
import { ExportController } from "../controllers/export.controller";
import { ExportProgressController } from "../controllers/export-progress.controller";
import { authenticate } from "../middleware/auth.middleware";
import { asyncHandler } from "../utils/asyncHandler.utils";
import { exportLimiter } from "../middleware/rate-limit.middleware";

const router = Router();

router.use(authenticate);

/**
 * @swagger
 * /users/me/export:
 *   post:
 *     summary: Request personal data export (GDPR portability)
 *     description: >
 *       Enqueues a data export job. The user receives real-time progress via
 *       Socket.IO `export:progress` events and a final `export:ready` event
 *       with the download URL. An email notification is also sent on completion.
 *     tags: [Export]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               format:
 *                 type: string
 *                 enum: [json, csv, pdf]
 *                 default: json
 *                 description: >
 *                   json — single ZIP with one JSON file per entity (default).
 *                   csv  — ZIP with one CSV file per entity (flat, spreadsheet-friendly).
 *                   pdf  — formatted PDF report (summary + tables).
 */
router.post(
  "/users/me/export",
  exportLimiter,
  asyncHandler(ExportProgressController.requestExport),
);

/**
 * @swagger
 * /users/me/export/{jobId}:
 *   get:
 *     summary: Check export status (DB only, no BullMQ)
 *     tags: [Export]
 */
router.get(
  "/users/me/export/:jobId",
  asyncHandler(ExportController.getExportStatus),
);

/**
 * @swagger
 * /exports/{jobId}/progress:
 *   get:
 *     summary: Live BullMQ progress for an export job (0–100 %)
 *     description: >
 *       Reads the BullMQ job's current progress percentage without
 *       re-executing the export. Suitable for polling (recommended every 5s).
 *       Use Socket.IO `export:progress` for push-based updates instead.
 *     tags: [Export]
 *     parameters:
 *       - name: jobId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Progress snapshot
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 jobId: { type: string }
 *                 status: { type: string, enum: [pending, processing, completed, failed] }
 *                 percent: { type: integer, minimum: -1, maximum: 100 }
 *                 format: { type: string, enum: [json, csv, pdf] }
 *                 bullmqState: { type: string, nullable: true }
 *                 approvalStatus: { type: string, nullable: true }
 *                 actualSizeBytes: { type: integer, nullable: true }
 *       404:
 *         description: Export job not found
 */
router.get(
  "/exports/:jobId/progress",
  asyncHandler(ExportProgressController.getProgress),
);

/**
 * @swagger
 * /users/me/export/{jobId}/download:
 *   get:
 *     summary: Generate a presigned S3 download URL for a completed export
 *     tags: [Export]
 */
router.get(
  "/users/me/export/:jobId/download",
  asyncHandler(ExportController.downloadExport),
);

/**
 * @swagger
 * /mentors/me/earnings/export:
 *   get:
 *     summary: CSV earnings export for mentors
 *     tags: [Export]
 */
router.get(
  "/mentors/me/earnings/export",
  asyncHandler(ExportController.exportEarnings),
);

export default router;
