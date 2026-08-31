import { z } from 'zod';
import { uuidSchema, shortTextSchema, longTextSchema } from './common.schemas';

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

export const adminIdParamSchema = z.object({
    params: z.object({ id: uuidSchema }),
});

export const adminDeliveryIdParamSchema = z.object({
    params: z.object({ deliveryId: uuidSchema }),
});

export const adminTemplateParamSchema = z.object({
    params: z.object({
        template: z
            .string()
            .trim()
            .min(1, 'Template name is required')
            .max(100, 'Template name is too long')
            .regex(/^[a-zA-Z0-9_-]+$/, 'Template name contains invalid characters'),
    }),
});

// ---------------------------------------------------------------------------
// GET /admin/users
// ---------------------------------------------------------------------------

export const listAdminUsersSchema = z.object({
    query: z.object({
        page: z
            .string()
            .optional()
            .transform((v) => (v ? parseInt(v, 10) : 1))
            .refine((v) => Number.isInteger(v) && v >= 1 && v <= 1_000_000, 'Invalid page'),
        limit: z
            .string()
            .optional()
            .transform((v) => (v ? parseInt(v, 10) : 50))
            .refine((v) => Number.isInteger(v) && v >= 1 && v <= 100, 'Limit must be between 1 and 100'),
        role: z.enum(['mentor', 'mentee', 'admin']).optional(),
    }),
});

// ---------------------------------------------------------------------------
// PUT /admin/users/:id/status
// ---------------------------------------------------------------------------

export const updateUserStatusSchema = z.object({
    params: z.object({ id: uuidSchema }),
    body: z
        .object({
            isActive: z.boolean(),
        })
        .strict(),
});

// ---------------------------------------------------------------------------
// PUT /admin/users/:id/tier
// ---------------------------------------------------------------------------

export const updateUserTierSchema = z.object({
    params: z.object({ id: uuidSchema }),
    body: z
        .object({
            tier: z.enum(['free', 'pro', 'enterprise']),
        })
        .strict(),
});

// ---------------------------------------------------------------------------
// PUT /admin/users/:id/suspend
// ---------------------------------------------------------------------------

export const suspendUserSchema = z.object({
    params: z.object({ id: uuidSchema }),
    body: z
        .object({
            reason: shortTextSchema,
            expiresAt: z.string().datetime().optional(),
        })
        .strict(),
});

// ---------------------------------------------------------------------------
// PUT /admin/users/:id/ban
// ---------------------------------------------------------------------------

export const banUserSchema = z.object({
    params: z.object({ id: uuidSchema }),
    body: z
        .object({
            reason: shortTextSchema,
        })
        .strict(),
});

// ---------------------------------------------------------------------------
// GET /admin/transactions
// ---------------------------------------------------------------------------

export const listAdminTransactionsSchema = z.object({
    query: z.object({
        page: z
            .string()
            .optional()
            .transform((v) => (v ? parseInt(v, 10) : 1))
            .refine((v) => Number.isInteger(v) && v >= 1 && v <= 1_000_000, 'Invalid page'),
        limit: z
            .string()
            .optional()
            .transform((v) => (v ? parseInt(v, 10) : 50))
            .refine((v) => Number.isInteger(v) && v >= 1 && v <= 100, 'Limit must be between 1 and 100'),
    }),
});

// ---------------------------------------------------------------------------
// GET /admin/sessions
// ---------------------------------------------------------------------------

export const listAdminSessionsSchema = z.object({
    query: z.object({
        limit: z
            .string()
            .optional()
            .transform((v) => (v ? parseInt(v, 10) : 50))
            .refine((v) => Number.isInteger(v) && v >= 1 && v <= 100, 'Limit must be between 1 and 100'),
        offset: z
            .string()
            .optional()
            .transform((v) => (v ? parseInt(v, 10) : 0))
            .refine((v) => Number.isInteger(v) && v >= 0 && v <= 10_000_000, 'Invalid offset'),
        status: z.string().trim().max(50).optional(),
    }),
});

// ---------------------------------------------------------------------------
// GET /admin/payments
// ---------------------------------------------------------------------------

export const listAdminPaymentsSchema = z.object({
    query: z.object({
        limit: z
            .string()
            .optional()
            .transform((v) => (v ? parseInt(v, 10) : 50))
            .refine((v) => Number.isInteger(v) && v >= 1 && v <= 100, 'Limit must be between 1 and 100'),
        offset: z
            .string()
            .optional()
            .transform((v) => (v ? parseInt(v, 10) : 0))
            .refine((v) => Number.isInteger(v) && v >= 0 && v <= 10_000_000, 'Invalid offset'),
        startDate: z.string().trim().max(40).optional(),
        endDate: z.string().trim().max(40).optional(),
    }),
});

// ---------------------------------------------------------------------------
// GET /admin/disputes
// ---------------------------------------------------------------------------

export const listAdminDisputesSchema = z.object({
    query: z.object({
        page: z
            .string()
            .optional()
            .transform((v) => (v ? parseInt(v, 10) : 1))
            .refine((v) => Number.isInteger(v) && v >= 1 && v <= 1_000_000, 'Invalid page'),
        limit: z
            .string()
            .optional()
            .transform((v) => (v ? parseInt(v, 10) : 50))
            .refine((v) => Number.isInteger(v) && v >= 1 && v <= 100, 'Limit must be between 1 and 100'),
    }),
});

// ---------------------------------------------------------------------------
// POST /admin/disputes/:id/resolve
// ---------------------------------------------------------------------------

export const resolveDisputeSchema = z.object({
    params: z.object({ id: uuidSchema }),
    body: z
        .object({
            status: z.enum(['resolved', 'dismissed']),
            notes: longTextSchema.optional(),
        })
        .strict(),
});

// ---------------------------------------------------------------------------
// GET /admin/logs
// ---------------------------------------------------------------------------

export const getAdminLogsSchema = z.object({
    query: z.object({
        page: z
            .string()
            .optional()
            .transform((v) => (v ? parseInt(v, 10) : 1))
            .refine((v) => Number.isInteger(v) && v >= 1 && v <= 1_000_000, 'Invalid page'),
        limit: z
            .string()
            .optional()
            .transform((v) => (v ? parseInt(v, 10) : 50))
            .refine((v) => Number.isInteger(v) && v >= 1 && v <= 100, 'Limit must be between 1 and 100'),
        action: z.string().trim().max(100).optional(),
        userId: uuidSchema.optional(),
        level: z.string().trim().max(20).optional(),
    }),
});

// ---------------------------------------------------------------------------
// POST /admin/config
// ---------------------------------------------------------------------------

export const updateConfigSchema = z.object({
    body: z
        .object({
            key: z.string().trim().min(1).max(200),
            value: z.union([z.string().max(2000), z.number(), z.boolean()]),
        })
        .strict(),
});

// ---------------------------------------------------------------------------
// GET /admin/audit-log, /admin/audit-log/export
// ---------------------------------------------------------------------------

export const getAuditLogSchema = z.object({
    query: z.object({
        page: z
            .string()
            .optional()
            .transform((v) => (v ? parseInt(v, 10) : 1))
            .refine((v) => Number.isInteger(v) && v >= 1 && v <= 1_000_000, 'Invalid page'),
        limit: z
            .string()
            .optional()
            .transform((v) => (v ? parseInt(v, 10) : 50))
            .refine((v) => Number.isInteger(v) && v >= 1 && v <= 100, 'Limit must be between 1 and 100'),
        userId: uuidSchema.optional(),
        action: z.string().trim().max(100).optional(),
        resourceType: z.string().trim().max(100).optional(),
        startDate: z.string().trim().max(40).optional(),
        endDate: z.string().trim().max(40).optional(),
    }),
});

export const exportAuditLogSchema = z.object({
    query: z.object({
        userId: uuidSchema.optional(),
        action: z.string().trim().max(100).optional(),
        resourceType: z.string().trim().max(100).optional(),
        startDate: z.string().trim().max(40).optional(),
        endDate: z.string().trim().max(40).optional(),
    }),
});

export const auditLogStatsSchema = z.object({
    query: z.object({
        startDate: z.string().trim().max(40).optional(),
        endDate: z.string().trim().max(40).optional(),
    }),
});

// ---------------------------------------------------------------------------
// POST /admin/email/preview/:template
// ---------------------------------------------------------------------------

export const previewEmailTemplateSchema = z.object({
    params: z.object({
        template: z
            .string()
            .trim()
            .min(1, 'Template name is required')
            .max(100, 'Template name is too long')
            .regex(/^[a-zA-Z0-9_-]+$/, 'Template name contains invalid characters'),
    }),
    body: z.record(z.string(), z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export const revenueSummarySchema = z.object({
    query: z.object({
        period: z.enum(['7d', '30d', '90d', '1y']).optional(),
    }),
});

export const dailyRevenueSchema = z.object({
    query: z.object({
        from: z.string().trim().min(1).max(40),
        to: z.string().trim().min(1).max(40),
    }),
});

export const transactionReportSchema = z.object({
    query: z.object({
        status: z.string().trim().max(50).optional(),
        from: z.string().trim().min(1).max(40),
        to: z.string().trim().min(1).max(40),
    }),
});

export const exportReportSchema = z.object({
    query: z.object({
        type: z.enum(['revenue']).optional(),
        format: z.enum(['csv']).optional(),
        from: z.string().trim().max(40).optional(),
        to: z.string().trim().max(40).optional(),
        status: z.string().trim().max(50).optional(),
    }),
});

// ---------------------------------------------------------------------------
// Security blocklist / allowlist
// ---------------------------------------------------------------------------

export const addBlocklistRuleSchema = z.object({
    body: z
        .object({
            ipRange: z.string().trim().min(1).max(64),
            reason: shortTextSchema.optional(),
        })
        .strict(),
});

export const removeBlocklistRuleSchema = z.object({
    params: z.object({ id: uuidSchema }),
});

export const addAllowlistRuleSchema = z.object({
    body: z
        .object({
            ipRange: z.string().trim().min(1).max(64),
            reason: shortTextSchema.optional(),
        })
        .strict(),
});

// ---------------------------------------------------------------------------
// Verifications
// ---------------------------------------------------------------------------

export const approveVerificationSchema = z.object({
    params: z.object({ id: uuidSchema }),
});

// ---------------------------------------------------------------------------
// Webhook delivery retry
// ---------------------------------------------------------------------------

export const retryWebhookDeliverySchema = z.object({
    params: z.object({ deliveryId: uuidSchema }),
});
