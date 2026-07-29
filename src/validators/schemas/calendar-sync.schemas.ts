import { z } from 'zod';

// `provider` is a fixed enum slug (google/outlook/apple), not a UUID.
const providerEnum = z.enum(['google', 'outlook', 'apple']);

export const providerParamSchema = z.object({
    params: z.object({ provider: providerEnum }),
});

export const toggleSyncSchema = z.object({
    params: z.object({ provider: providerEnum }),
    body: z
        .object({
            enabled: z.boolean(),
        })
        .strict(),
});

export const appleConnectSchema = z.object({
    body: z
        .object({
            apple_id: z.string().trim().min(1).max(254),
            app_password: z.string().trim().min(1).max(200),
        })
        .strict(),
});
