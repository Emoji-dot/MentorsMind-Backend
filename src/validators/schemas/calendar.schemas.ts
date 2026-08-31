import { z } from 'zod';

export const icalTokenParamSchema = z.object({
    params: z.object({
        token: z
            .string()
            .trim()
            .length(64, 'Token must be exactly 64 characters')
            .regex(/^[a-fA-F0-9]+$/, 'Token must be hexadecimal'),
    }),
});

export const googleOAuthCallbackSchema = z.object({
    query: z.object({
        code: z.string().trim().max(2048).optional(),
        state: z.string().trim().max(500).optional(),
        error: z.string().trim().max(200).optional(),
    }),
});
