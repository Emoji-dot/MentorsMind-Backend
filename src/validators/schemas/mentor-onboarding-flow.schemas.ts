import { z } from 'zod';
import { longTextSchema } from './common.schemas';

const slugParam = z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/, 'Invalid identifier');

export const completeOnboardingStepFlowSchema = z.object({
    params: z.object({ stepId: slugParam }),
});

export const pauseOnboardingSchema = z.object({
    body: z
        .object({
            reason: longTextSchema.optional(),
        })
        .strict()
        .optional(),
});

export const completeChecklistItemSchema = z.object({
    params: z.object({ itemKey: slugParam }),
});
