import { z } from 'zod';
import { uuidSchema } from './common.schemas';

export const submitFeedbackSchema = z.object({
    body: z
        .object({
            session_id: uuidSchema,
            rating_content: z.number().int().min(1).max(5),
            rating_communication: z.number().int().min(1).max(5),
            rating_preparation: z.number().int().min(1).max(5),
            rating_value: z.number().int().min(1).max(5),
            comment: z.string().trim().max(2000).optional(),
            improvements: z.array(z.string().trim().max(500)).optional(),
            would_recommend: z.boolean().optional(),
        })
        .strict(),
});

export const sessionIdParamSchema = z.object({
    params: z.object({ sessionId: uuidSchema }),
});

export const mentorFeedbackParamSchema = z.object({
    params: z.object({ mentorId: uuidSchema }),
    query: z.object({
        page: z.string().optional(),
        limit: z.string().optional(),
    }),
});

export const mentorIdParamSchema = z.object({
    params: z.object({ mentorId: uuidSchema }),
});
