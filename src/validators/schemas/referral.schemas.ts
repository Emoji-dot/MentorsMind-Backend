import { z } from 'zod';
import { uuidSchema, emailSchema } from './common.schemas';

export const createReferralCodeSchema = z.object({
    body: z
        .object({
            codeType: z.enum(['personal', 'campaign']).optional(),
            customCode: z
                .string()
                .trim()
                .min(3)
                .max(30)
                .regex(/^[A-Za-z0-9_-]+$/, 'customCode must be alphanumeric')
                .optional(),
            maxUses: z.number().int().min(1).max(1_000_000).optional(),
            expiresAt: z.string().datetime().optional(),
            metadata: z.record(z.string(), z.unknown()).optional(),
        })
        .strict(),
});

export const referralCodeParamSchema = z.object({
    params: z.object({
        code: z.string().trim().min(1).max(30),
    }),
});

export const applyReferralCodeSchema = z.object({
    body: z
        .object({
            referralCode: z.string().trim().min(1).max(30),
            referredEmail: emailSchema.optional(),
            metadata: z.record(z.string(), z.unknown()).optional(),
        })
        .strict(),
});

export const listUserReferralsSchema = z.object({
    query: z.object({
        status: z
            .enum(['pending', 'registered', 'completed', 'rewarded', 'expired', 'cancelled'])
            .optional(),
    }),
});

export const referralStatsQuerySchema = z.object({
    query: z.object({
        global: z.enum(['true', 'false']).optional(),
    }),
});

export const referralIdParamSchema = z.object({
    params: z.object({ referralId: uuidSchema }),
});

export const updateReferralSchema = z.object({
    params: z.object({ referralId: uuidSchema }),
    body: z
        .object({
            status: z
                .enum(['pending', 'registered', 'completed', 'rewarded', 'expired', 'cancelled'])
                .optional(),
            conversionType: z.string().trim().max(100).optional(),
            referredUserId: uuidSchema.optional(),
            metadata: z.record(z.string(), z.unknown()).optional(),
        })
        .strict(),
});

export const createAffiliateProfileSchema = z.object({
    body: z
        .object({
            stellarAddress: z.string().trim().min(1).max(60).optional(),
            paymentSchedule: z.string().trim().max(50).optional(),
            minimumPayout: z.number().min(0).max(1_000_000).optional(),
        })
        .strict(),
});

export const affiliateUserIdParamSchema = z.object({
    params: z.object({ userId: uuidSchema }),
});

export const updateAffiliateProfileSchema = z.object({
    params: z.object({ userId: uuidSchema }),
    body: z
        .object({
            stellarAddress: z.string().trim().min(1).max(60).optional(),
            paymentSchedule: z.string().trim().max(50).optional(),
            minimumPayout: z.number().min(0).max(1_000_000).optional(),
        })
        .strict(),
});

export const requestPayoutSchema = z.object({
    params: z.object({ userId: uuidSchema }),
    body: z
        .object({
            amount: z.number().positive().max(1_000_000),
            payoutType: z.string().trim().max(50).optional(),
            metadata: z.record(z.string(), z.unknown()).optional(),
        })
        .strict(),
});
