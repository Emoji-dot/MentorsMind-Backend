import { z } from 'zod';
import { uuidSchema } from './common.schemas';

const flagKeySchema = z
    .string()
    .trim()
    .min(1, 'key is required')
    .max(255)
    .regex(/^[a-zA-Z0-9_.-]+$/, 'key must be alphanumeric with -, _, . allowed');

const flagVariantSchema = z.object({
    key: z.string().trim().min(1).max(100),
    weight: z.number().min(0).max(100).optional(),
    payload: z.unknown().optional(),
}).passthrough();

const flagTargetingSchema = z.record(z.string(), z.unknown());

export const flagKeyParamSchema = z.object({
    params: z.object({ key: flagKeySchema }),
});

export const flagIdParamSchema = z.object({
    params: z.object({ id: uuidSchema }),
});

export const evaluateFlagSchema = z.object({
    params: z.object({ key: flagKeySchema }),
    query: z.object({
        userId: z.string().trim().max(200).optional(),
        segment: z.string().trim().max(200).optional(),
        tenantId: uuidSchema.optional(),
    }),
});

export const trackConversionSchema = z.object({
    params: z.object({ key: flagKeySchema }),
    body: z
        .object({
            userId: z.string().trim().min(1).max(200),
            variant: z.string().trim().max(100).optional(),
            metadata: z.record(z.string(), z.unknown()).optional(),
        })
        .strict(),
});

export const createFeatureFlagSchema = z.object({
    body: z
        .object({
            key: flagKeySchema,
            name: z.string().trim().min(1).max(255),
            description: z.string().trim().max(2000).optional(),
            enabled: z.boolean().optional(),
            rolloutPercentage: z.number().min(0).max(100).optional(),
            targeting: flagTargetingSchema.optional(),
            variants: z.array(flagVariantSchema).max(50).optional(),
        })
        .strict(),
});

export const updateFeatureFlagSchema = z.object({
    params: z.object({ id: uuidSchema }),
    body: z
        .object({
            name: z.string().trim().min(1).max(255).optional(),
            description: z.string().trim().max(2000).optional(),
            enabled: z.boolean().optional(),
            rolloutPercentage: z.number().min(0).max(100).optional(),
            targeting: flagTargetingSchema.optional(),
            variants: z.array(flagVariantSchema).max(50).optional(),
        })
        .strict(),
});

export const getMetricsSchema = z.object({
    params: z.object({ key: flagKeySchema }),
    query: z.object({
        since: z.string().datetime().optional(),
    }),
});
