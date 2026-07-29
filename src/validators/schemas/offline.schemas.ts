import { z } from 'zod';
import { uuidSchema } from './common.schemas';

const domainEnum = z.enum(['bookings', 'notifications', 'profile', 'goals', 'messages']);

const actionTypeEnum = z.enum([
    'booking:create',
    'booking:cancel',
    'booking:reschedule',
    'review:create',
    'note:create',
    'note:update',
    'goal:update',
    'profile:update',
    'message:send',
]);

// clientKey is validated by the controller with /^[0-9a-f-]{36}$/i (UUID-shaped);
// uuidSchema (UUID v4) is a safe, slightly stricter subset to enforce at the edge.
const offlineActionSchema = z
    .object({
        clientKey: uuidSchema,
        actionType: actionTypeEnum,
        payload: z.record(z.string(), z.unknown()),
        clientTimestamp: z.string().datetime(),
    })
    .strict();

export const getSnapshotSchema = z.object({
    query: z.object({
        refresh: z.string().optional(),
    }),
});

export const getDeltaSchema = z.object({
    query: z.object({
        domain: domainEnum,
        since: z.string().datetime('since must be a valid ISO 8601 timestamp'),
    }),
});

export const getQueueSchema = z.object({
    query: z.object({
        status: z.enum(['pending', 'processing', 'completed', 'failed', 'conflict']).optional(),
        limit: z.string().optional(),
        offset: z.string().optional(),
    }),
});

export const enqueueActionSchema = z.object({
    body: offlineActionSchema,
});

export const syncSchema = z.object({
    body: z
        .object({
            syncState: z
                .object({
                    domains: z.record(z.string(), z.string()),
                })
                .strict(),
            actions: z.array(offlineActionSchema).optional(),
        })
        .strict(),
});

export const resolveConflictSchema = z.object({
    params: z.object({ id: uuidSchema }),
    body: z
        .object({
            strategy: z.enum(['client_wins', 'server_wins', 'merge']),
            mergedPayload: z.record(z.string(), z.unknown()).optional(),
        })
        .strict(),
});
