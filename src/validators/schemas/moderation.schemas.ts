import { z } from 'zod';
import { uuidSchema, longTextSchema } from './common.schemas';

const paginationQuery = z.object({
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
});

export const moderationFlagIdParamSchema = z.object({
    params: z.object({ id: uuidSchema }),
});

export const getModerationQueueSchema = z.object({
    query: paginationQuery,
});

export const getAIQueueSchema = z.object({
    query: paginationQuery,
});

export const triggerAIScanSchema = z.object({
    body: z
        .object({
            contentId: z.string().trim().min(1).max(200),
            contentType: z.enum(['profile', 'review', 'message']),
            text: z.string().trim().min(1).max(20000),
        })
        .strict(),
});

export const approveContentSchema = z.object({
    params: z.object({ id: uuidSchema }),
});

export const rejectContentSchema = z.object({
    params: z.object({ id: uuidSchema }),
    body: z
        .object({
            notes: longTextSchema.optional(),
            suspendHours: z
                .number()
                .int()
                .min(1, 'suspendHours must be at least 1')
                .max(8760, 'suspendHours must not exceed 8760 (1 year)')
                .optional(),
        })
        .strict(),
});

export const escalateFlagSchema = z.object({
    params: z.object({ id: uuidSchema }),
    body: z
        .object({
            notes: longTextSchema.optional(),
        })
        .strict(),
});

export const deleteFlagSchema = z.object({
    params: z.object({ id: uuidSchema }),
});

export const getAppealsSchema = z.object({
    query: paginationQuery.extend({
        status: z.string().trim().max(50).optional(),
    }),
});

export const resolveAppealSchema = z.object({
    params: z.object({ id: uuidSchema }),
    body: z
        .object({
            status: z.enum(['approved', 'rejected']),
            notes: longTextSchema.optional(),
        })
        .strict(),
});
