import { z } from 'zod';
import { uuidSchema, longTextSchema, urlSchema } from './common.schemas';

export const disputeIdParamSchema = z.object({
    params: z.object({ id: uuidSchema }),
});

export const openDisputeSchema = z.object({
    body: z
        .object({
            session_id: uuidSchema,
            type: z.string().trim().min(1).max(100),
            reason: longTextSchema,
        })
        .strict(),
});

export const uploadEvidenceSchema = z.object({
    params: z.object({ id: uuidSchema }),
    body: z
        .object({
            text_content: z.string().trim().max(5000).optional(),
            file_url: urlSchema.optional(),
        })
        .strict(),
});

export const resolveDisputeSchema = z.object({
    params: z.object({ id: uuidSchema }),
    body: z
        .object({
            mentor_pct: z
                .number()
                .min(0, 'mentor_pct must be at least 0')
                .max(100, 'mentor_pct must not exceed 100'),
            notes: longTextSchema.optional(),
        })
        .strict(),
});

export const mediateDisputeSchema = z.object({
    params: z.object({ id: uuidSchema }),
    body: z
        .object({
            notes: longTextSchema.optional(),
        })
        .strict(),
});
