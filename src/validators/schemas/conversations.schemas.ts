import { z } from 'zod';
import { uuidSchema } from './common.schemas';

export const createOrGetConversationSchema = z.object({
    body: z
        .object({
            participantId: uuidSchema,
        })
        .strict(),
});

export const conversationIdParamSchema = z.object({
    params: z.object({ id: uuidSchema }),
});

export const getMessagesSchema = z.object({
    params: z.object({ id: uuidSchema }),
    query: z.object({
        limit: z.string().optional(),
        cursor: z.string().trim().max(200).optional(),
    }),
});

export const sendMessageSchema = z.object({
    params: z.object({ id: uuidSchema }),
    body: z
        .object({
            body: z.string().trim().min(1, 'Message body is required').max(5000),
        })
        .strict(),
});

export const deleteMessageSchema = z.object({
    params: z.object({ id: uuidSchema, msgId: uuidSchema }),
});

export const markReadSchema = z.object({
    params: z.object({ id: uuidSchema }),
});

export const uploadAttachmentSchema = z.object({
    params: z.object({ id: uuidSchema }),
});
