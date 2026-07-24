import { z } from 'zod';

export const getOraclePriceSchema = z.object({
    params: z.object({
        asset: z
            .string()
            .trim()
            .min(1, 'Asset symbol is required')
            .max(12, 'Asset symbol is too long')
            .regex(/^[A-Za-z0-9]+$/, 'Asset symbol must be alphanumeric'),
    }),
});

export type GetOraclePriceInput = z.infer<typeof getOraclePriceSchema>['params'];
