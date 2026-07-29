import { z } from 'zod';
import { uuidSchema } from './common.schemas';

const languageParam = z
    .string()
    .trim()
    .min(2)
    .max(10)
    .regex(/^[a-zA-Z-]+$/, 'language must be a valid language code');

const segmentSchema = z.object({
    speakerId: z.string().trim().min(1).max(100),
    text: z.string().trim().max(10000),
    startTime: z.number().min(0).max(86_400),
    endTime: z.number().min(0).max(86_400),
    confidence: z.number().min(0).max(1),
});

const speakerSchema = z.object({
    id: z.string().trim().min(1).max(100),
    label: z.string().trim().max(200),
    totalSpeakingTime: z.number().min(0).max(86_400),
});

export const sessionIdParamSchema = z.object({
    params: z.object({ sessionId: uuidSchema }),
});

export const saveTranscriptSchema = z.object({
    params: z.object({ sessionId: uuidSchema }),
    body: z
        .object({
            language: languageParam,
            segments: z.array(segmentSchema).max(10_000),
            speakers: z.array(speakerSchema).max(100),
            keywords: z.array(z.string().trim().max(200)).max(500),
            summary: z.string().trim().max(20000),
        })
        .strict(),
});

export const updateTranscriptSchema = z.object({
    params: z.object({ sessionId: uuidSchema }),
    body: z
        .object({
            language: languageParam.optional(),
            segments: z.array(segmentSchema).max(10_000).optional(),
            speakers: z.array(speakerSchema).max(100).optional(),
            keywords: z.array(z.string().trim().max(200)).max(500).optional(),
            summary: z.string().trim().max(20000).optional(),
        })
        .strict(),
});

export const searchTranscriptsSchema = z.object({
    query: z.object({
        q: z.string().trim().min(1).max(500),
    }),
});

export const translationParamSchema = z.object({
    params: z.object({
        sessionId: uuidSchema,
        language: languageParam,
    }),
});

export const saveTranslationSchema = z.object({
    params: z.object({
        sessionId: uuidSchema,
        language: languageParam,
    }),
    body: z
        .object({
            segments: z.array(segmentSchema).max(10_000),
            summary: z.string().trim().max(20000),
        })
        .strict(),
});
