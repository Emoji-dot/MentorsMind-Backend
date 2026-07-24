import { z } from 'zod';

export const taxYearParamSchema = z.object({
    params: z.object({
        year: z
            .string()
            .regex(/^\d{4}$/, 'year must be a 4-digit year')
            .refine((v) => {
                const y = parseInt(v, 10);
                return y >= 2000 && y <= 2100;
            }, 'year must be between 2000 and 2100'),
    }),
});
