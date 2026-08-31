import { z } from 'zod';
import { uuidSchema, longTextSchema } from './common.schemas';

export const getCertificationTypesSchema = z.object({
    query: z.object({
        activeOnly: z.enum(['true', 'false']).optional(),
    }),
});

export const createCertificationSchema = z.object({
    body: z
        .object({
            certificationTypeId: uuidSchema,
            verificationMethod: z.string().trim().min(1).max(100),
            metadata: z.record(z.string(), z.unknown()).optional(),
            notes: longTextSchema.optional(),
        })
        .strict(),
});

export const getMentorCertificationsSchema = z.object({
    params: z.object({ mentorId: uuidSchema }),
    query: z.object({
        includeExpired: z.enum(['true', 'false']).optional(),
    }),
});

export const getCertificationSummarySchema = z.object({
    params: z.object({ mentorId: uuidSchema }),
});

export const certificationStatusEnum = z.enum([
    'pending',
    'approved',
    'rejected',
    'revoked',
    'expired',
]);

export const updateCertificationSchema = z.object({
    params: z.object({ certificationId: uuidSchema }),
    body: z
        .object({
            status: certificationStatusEnum.optional(),
            score: z.number().min(0).max(100).optional(),
            metadata: z.record(z.string(), z.unknown()).optional(),
            notes: longTextSchema.optional(),
            revocationReason: longTextSchema.optional(),
        })
        .strict(),
});

export const verifyCertificationSchema = z.object({
    params: z.object({ certificationId: uuidSchema }),
    body: z
        .object({
            status: certificationStatusEnum,
            notes: longTextSchema.optional(),
        })
        .strict(),
});

export const startSkillTestSchema = z.object({
    params: z.object({ testId: uuidSchema }),
    body: z
        .object({
            certificationId: uuidSchema.optional(),
        })
        .strict()
        .optional(),
});

export const submitTestAnswersSchema = z.object({
    params: z.object({ attemptId: uuidSchema }),
    body: z
        .object({
            answers: z.array(z.unknown()).min(1).max(500),
        })
        .strict(),
});

export const initiateBackgroundCheckSchema = z.object({
    body: z
        .object({
            certificationId: uuidSchema.optional(),
            checkType: z.string().trim().min(1).max(100),
            provider: z.string().trim().min(1).max(100),
        })
        .strict(),
});

export const getBackgroundCheckSchema = z.object({
    params: z.object({ checkId: uuidSchema }),
});

export const getOnboardingProgressSchema = z.object({
    params: z.object({ mentorId: uuidSchema }),
});

export const completeOnboardingStepSchema = z.object({
    params: z.object({
        mentorId: uuidSchema,
        stepId: z.string().trim().min(1).max(100),
    }),
});

export const getPendingCertificationsSchema = z.object({
    query: z.object({
        limit: z
            .string()
            .optional()
            .transform((v) => (v ? parseInt(v, 10) : 50))
            .refine((v) => Number.isInteger(v) && v >= 1 && v <= 100, 'Limit must be between 1 and 100'),
    }),
});
