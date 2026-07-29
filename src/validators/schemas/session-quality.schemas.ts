import { z } from 'zod';
import { uuidSchema } from './common.schemas';

export const sessionIdParamSchema = z.object({
    params: z.object({ sessionId: uuidSchema }),
});

export const mentorTrendSchema = z.object({
    params: z.object({ mentorId: uuidSchema }),
    query: z.object({
        days: z
            .string()
            .optional()
            .transform((v) => (v ? parseInt(v, 10) : 90))
            .refine((v) => v >= 7 && v <= 365, 'days must be between 7 and 365'),
    }),
});

export const mentorIdParamSchema = z.object({
    params: z.object({ mentorId: uuidSchema }),
});

export const topSessionsSchema = z.object({
    params: z.object({ mentorId: uuidSchema }),
    query: z.object({
        limit: z
            .string()
            .optional()
            .transform((v) => (v ? parseInt(v, 10) : 5))
            .refine((v) => v >= 1 && v <= 20, 'limit must be between 1 and 20'),
    }),
});
