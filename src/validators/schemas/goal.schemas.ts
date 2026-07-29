import { z } from 'zod';
import { uuidSchema, longTextSchema } from './common.schemas';

export const createGoalSchema = z.object({
    body: z
        .object({
            title: z.string().trim().min(1, 'title is required').max(500),
            description: longTextSchema.optional(),
            target_date: z.string().date().optional(),
            progress: z.number().min(0).max(100).optional(),
            status: z.enum(['active', 'completed', 'paused']).optional(),
        })
        .strict(),
});

export const goalIdParamSchema = z.object({
    params: z.object({ id: uuidSchema }),
});

export const updateGoalSchema = z.object({
    params: z.object({ id: uuidSchema }),
    body: z
        .object({
            title: z.string().trim().min(1).max(500).optional(),
            description: longTextSchema.optional(),
            target_date: z.string().date().optional(),
            progress: z.number().min(0).max(100).optional(),
            status: z.enum(['active', 'completed', 'paused']).optional(),
        })
        .strict(),
});

export const updateGoalProgressSchema = z.object({
    params: z.object({ id: uuidSchema }),
    body: z
        .object({
            progress: z.number().min(0).max(100),
            notes: longTextSchema.optional(),
        })
        .strict(),
});

export const linkSessionSchema = z.object({
    params: z.object({ id: uuidSchema }),
    body: z
        .object({
            booking_id: uuidSchema,
        })
        .strict(),
});
