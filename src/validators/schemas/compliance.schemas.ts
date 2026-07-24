import { z } from 'zod';
import { uuidSchema, longTextSchema } from './common.schemas';

export const createDSARSchema = z.object({
    body: z
        .object({
            type: z.enum(['access', 'deletion', 'portability', 'rectification']),
            metadata: z.record(z.string(), z.unknown()).optional(),
        })
        .strict(),
});

export const dsarIdParamSchema = z.object({
    params: z.object({ id: uuidSchema }),
});

export const completeDSARSchema = z.object({
    params: z.object({ id: uuidSchema }),
    body: z
        .object({
            data: z.record(z.string(), z.unknown()).optional(),
        })
        .strict()
        .optional(),
});

export const createRetentionPolicySchema = z.object({
    body: z
        .object({
            dataType: z.string().trim().min(1).max(200),
            retentionPeriod: z.number().int().min(1).max(36_500, 'retentionPeriod must not exceed 100 years'),
            deletionMethod: z.enum(['soft', 'hard', 'anonymize']),
            legalBasis: z.string().trim().min(1).max(500),
        })
        .strict(),
});

export const recordLineageEventSchema = z.object({
    body: z
        .object({
            dataType: z.string().trim().min(1).max(200),
            sourceSystem: z.string().trim().min(1).max(200),
            destinationSystem: z.string().trim().min(1).max(200),
            description: longTextSchema,
            metadata: z.record(z.string(), z.unknown()).optional(),
        })
        .strict(),
});

export const complianceReportFiltersSchema = z.object({
    query: z.object({
        startDate: z.string().trim().max(40).optional(),
        endDate: z.string().trim().max(40).optional(),
        userId: uuidSchema.optional(),
    }),
});

export const listLineageEventsSchema = z.object({
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
        startDate: z.string().trim().max(40).optional(),
        endDate: z.string().trim().max(40).optional(),
        userId: uuidSchema.optional(),
    }),
});
