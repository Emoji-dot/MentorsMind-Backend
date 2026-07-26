import { Router } from "express";
import { InvoiceController } from "../controllers/invoice.controller";
import { validate } from "../middleware/validation.middleware";
import { authenticate } from "../middleware/auth.middleware";
import {
  createInvoiceSchema,
  invoiceIdParamSchema,
  listInvoicesSchema,
  updateInvoiceStatusSchema,
  bulkExportInvoicesSchema,
} from "../validators/schemas/invoice.schemas";

const router = Router();

// All invoice routes require authentication
router.use(authenticate as any);

router.post(
  "/invoices",
  validate(createInvoiceSchema),
  InvoiceController.createInvoice,
);

router.get(
  "/invoices",
  validate(listInvoicesSchema),
  InvoiceController.listInvoices,
);

router.get(
  "/invoices/export",
  validate(bulkExportInvoicesSchema),
  InvoiceController.bulkExport,
);

router.get(
  "/invoices/:invoiceId",
  validate(invoiceIdParamSchema),
  InvoiceController.getInvoice,
);

router.patch(
  "/invoices/:invoiceId/status",
  validate(updateInvoiceStatusSchema),
  InvoiceController.updateStatus,
);

/**
 * @openapi
 * /invoices/{invoiceId}/download:
 *   get:
 *     summary: Get a presigned S3 download URL for an invoice PDF
 *     description: >
 *       Returns a presigned URL valid for 1 hour. If the PDF has not been
 *       generated yet it is generated on-demand before the URL is returned.
 *     tags: [Invoices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: invoiceId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Presigned download URL
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     downloadUrl:
 *                       type: string
 *                       format: uri
 *                     expiresInSeconds:
 *                       type: integer
 *                       example: 3600
 *                     invoiceNumber:
 *                       type: string
 *       403:
 *         description: Access denied — not your invoice
 *       404:
 *         description: Invoice not found
 */
router.get(
  "/invoices/:invoiceId/download",
  validate(invoiceIdParamSchema),
  InvoiceController.downloadInvoice,
);

/**
 * @openapi
 * /invoices/{invoiceId}/send:
 *   post:
 *     summary: Generate the invoice PDF, email it to the owner, and mark as sent
 *     description: >
 *       Idempotent with respect to PDF generation — if the PDF already exists
 *       it is not regenerated. The invoice status is set to "sent" on success.
 *     tags: [Invoices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: invoiceId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Invoice sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     invoiceId:
 *                       type: string
 *                     status:
 *                       type: string
 *                       example: sent
 *       403:
 *         description: Access denied
 *       404:
 *         description: Invoice not found
 */
router.post(
  "/invoices/:invoiceId/send",
  validate(invoiceIdParamSchema),
  InvoiceController.sendInvoice,
);

export default router;
