import { z } from 'zod';
import { uuidSchema, longTextSchema } from './common.schemas';

export const bookingIdParamSchema = z.object({
    params: z.object({ bookingId: uuidSchema }),
});

export const generateSummarySchema = z.object({
    params: z.object({ bookingId: uuidSchema }),
    body: z
        .object({
            transcriptId: uuidSchema.optional(),
            transcriptText: z.string().trim().max(200_000).optional(),
            sessionNotes: longTextSchema.optional(),
            sessionTitle: z.string().trim().max(500).optional(),
            sessionId: uuidSchema.optional(),
        })
        .strict(),
});

export const sessionIdParamSchema = z.object({
    params: z.object({ sessionId: uuidSchema }),
});

export const summaryIdParamSchema = z.object({
    params: z.object({ id: uuidSchema }),
});
