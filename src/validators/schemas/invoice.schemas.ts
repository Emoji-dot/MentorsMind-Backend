import { z } from 'zod';
import { uuidSchema } from './common.schemas';

const lineItemSchema = z.object({
    description: z.string().trim().min(1).max(500),
    quantity: z.number().positive().max(1_000_000),
    unitPrice: z.string().regex(/^\d+(\.\d{1,7})?$/, 'unitPrice must be a valid decimal'),
    total: z.string().regex(/^\d+(\.\d{1,7})?$/, 'total must be a valid decimal'),
    taxRate: z.number().min(0).max(1),
});

export const createInvoiceSchema = z.object({
    body: z
        .object({
            type: z.enum(['session', 'subscription', 'refund']),
            lineItems: z.array(lineItemSchema).min(1).max(200),
            currency: z.string().trim().min(1).max(12).optional(),
            dueDate: z.string().datetime().or(z.string().date()),
        })
        .strict(),
});

export const invoiceIdParamSchema = z.object({
    params: z.object({ invoiceId: uuidSchema }),
});

export const listInvoicesSchema = z.object({
    query: z.object({
        status: z.enum(['draft', 'sent', 'paid', 'overdue', 'cancelled']).optional(),
    }),
});

export const updateInvoiceStatusSchema = z.object({
    params: z.object({ invoiceId: uuidSchema }),
    body: z
        .object({
            status: z.enum(['draft', 'sent', 'paid', 'overdue', 'cancelled']),
        })
        .strict(),
});

export const bulkExportInvoicesSchema = z.object({
    query: z.object({
        from: z.string().trim().min(1).max(40),
        to: z.string().trim().min(1).max(40),
    }),
});
