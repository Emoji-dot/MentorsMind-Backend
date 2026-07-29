import { z } from 'zod';

const triggerEnum = z.enum([
    'new_booking',
    'session_completed',
    'payment_received',
    'new_review',
]);

const actionEnum = z.enum([
    'send_message',
    'create_note',
    'update_goal_progress',
]);

export const zapierSubscribeSchema = z.object({
    body: z
        .object({
            trigger: triggerEnum,
            targetUrl: z.string().trim().url('targetUrl must be a valid URL').max(2048),
            secret: z.string().trim().min(8).max(200).optional(),
            metadata: z.record(z.string(), z.unknown()).optional(),
        })
        .strict(),
});

export const zapierUnsubscribeSchema = z.object({
    body: z
        .object({
            subscriptionId: z.string().trim().min(1).max(200).optional(),
            targetUrl: z.string().trim().url().max(2048).optional(),
        })
        .strict()
        .refine((b) => b.subscriptionId !== undefined || b.targetUrl !== undefined, {
            message: 'subscriptionId or targetUrl is required',
        }),
});

export const zapierTriggerSampleParamSchema = z.object({
    params: z.object({ trigger: triggerEnum }),
});

export const zapierActionSampleParamSchema = z.object({
    params: z.object({ action: actionEnum }),
});

export const zapierExecuteActionSchema = z.object({
    params: z.object({ action: actionEnum }),
    body: z.record(z.string(), z.unknown()).optional(),
});
