import { z } from 'zod';

// Earn rule actions are a fixed set defined in loyalty.service.ts EARN_RULES.
const earnActionEnum = z.enum([
    'complete_session',
    'write_review',
    'referral',
    'daily_login',
]);

export const earnTokensSchema = z.object({
    body: z
        .object({
            action: earnActionEnum,
        })
        .strict(),
});

export const redeemTokensSchema = z.object({
    body: z
        .object({
            tokens: z.number().positive('tokens must be a positive number'),
        })
        .strict(),
});
