import { z } from 'zod';
import { uuidSchema, longTextSchema } from './common.schemas';

export const startRecordingSchema = z.object({
    params: z.object({ sessionId: uuidSchema }),
    body: z
        .object({
            format: z.string().trim().max(20).optional(),
        })
        .strict()
        .optional(),
});

export const recordingIdParamSchema = z.object({
    params: z.object({ recordingId: uuidSchema }),
});

export const uploadRecordingSchema = z.object({
    params: z.object({ recordingId: uuidSchema }),
    body: z
        .object({
            fileSize: z
                .number()
                .int()
                .min(0)
                .max(50 * 1024 * 1024 * 1024, 'fileSize exceeds max allowed (50GB)')
                .optional(),
            durationSeconds: z
                .number()
                .int()
                .min(0)
                .max(86_400, 'durationSeconds exceeds max allowed (24h)')
                .optional(),
            metadata: z.record(z.string(), z.unknown()).optional(),
        })
        .strict(),
});

export const completeRecordingSchema = z.object({
    params: z.object({ recordingId: uuidSchema }),
});

export const updateConsentSchema = z.object({
    params: z.object({ recordingId: uuidSchema }),
    body: z
        .object({
            consent: z.boolean(),
        })
        .strict(),
});

export const generatePlaybackUrlSchema = z.object({
    params: z.object({ recordingId: uuidSchema }),
    query: z.object({
        expiresIn: z
            .string()
            .optional()
            .transform((v) => (v ? parseInt(v, 10) : undefined))
            .refine((v) => v === undefined || (Number.isInteger(v) && v > 0 && v <= 86_400), {
                message: 'expiresIn must be between 1 and 86400 seconds',
            }),
    }),
});

export const startTranscriptionSchema = z.object({
    params: z.object({ recordingId: uuidSchema }),
    body: z
        .object({
            language: z.string().trim().max(10).optional(),
        })
        .strict()
        .optional(),
});

export const searchTranscriptionsSchema = z.object({
    query: z.object({
        query: z.string().trim().min(1).max(500).optional(),
    }),
});

export const createBookmarkSchema = z.object({
    params: z.object({ recordingId: uuidSchema }),
    body: z
        .object({
            type: z.string().trim().max(50).optional(),
            timestampSeconds: z.number().min(0).max(86_400),
            title: z.string().trim().max(200).optional(),
            note: longTextSchema.optional(),
            color: z.string().trim().max(20).optional(),
            durationSeconds: z.number().min(0).max(86_400).optional(),
            isPrivate: z.boolean().optional(),
        })
        .strict(),
});

export const bookmarkIdParamSchema = z.object({
    params: z.object({ bookmarkId: uuidSchema }),
});

export const updateBookmarkSchema = z.object({
    params: z.object({ bookmarkId: uuidSchema }),
    body: z
        .object({
            type: z.string().trim().max(50).optional(),
            timestampSeconds: z.number().min(0).max(86_400).optional(),
            title: z.string().trim().max(200).optional(),
            note: longTextSchema.optional(),
            color: z.string().trim().max(20).optional(),
            durationSeconds: z.number().min(0).max(86_400).optional(),
            isPrivate: z.boolean().optional(),
        })
        .strict(),
});
