import { Router } from "express";
import { InvoiceController } from "../controllers/invoice.controller";
import { validate } from "../middleware/validation.middleware";
import {
  createInvoiceSchema,
  invoiceIdParamSchema,
  listInvoicesSchema,
  updateInvoiceStatusSchema,
  bulkExportInvoicesSchema,
} from "../validators/schemas/invoice.schemas";

const router = Router();

router.post("/invoices", validate(createInvoiceSchema), InvoiceController.createInvoice);
router.get("/invoices", validate(listInvoicesSchema), InvoiceController.listInvoices);
router.get("/invoices/export", validate(bulkExportInvoicesSchema), InvoiceController.bulkExport);
router.get("/invoices/:invoiceId", validate(invoiceIdParamSchema), InvoiceController.getInvoice);
router.patch(
  "/invoices/:invoiceId/status",
  validate(updateInvoiceStatusSchema),
  InvoiceController.updateStatus,
);

export default router;
