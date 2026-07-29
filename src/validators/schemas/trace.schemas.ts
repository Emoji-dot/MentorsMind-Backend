import { z } from 'zod';

export const getTraceSchema = z.object({
    params: z.object({
        traceId: z
            .string()
            .trim()
            .regex(/^[0-9a-f]{32}$/i, 'traceId must be a 32-character hex string'),
    }),
});

export type GetTraceInput = z.infer<typeof getTraceSchema>['params'];
