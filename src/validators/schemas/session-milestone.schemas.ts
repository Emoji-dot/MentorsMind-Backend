import { z } from 'zod';
import { uuidSchema, shortTextSchema } from './common.schemas';

const sessionTypeEnum = z.enum(['milestone', 'support', 'assessment']);
const completionStatusEnum = z.enum(['not_started', 'in_progress', 'completed', 'needs_review']);
const followUpEnum = z.enum(['continue', 'assessment', 'support', 'complete']);

export const bookingIdParamSchema = z.object({
    params: z.object({ bookingId: uuidSchema }),
});

export const milestoneIdParamSchema = z.object({
    params: z.object({ milestoneId: uuidSchema }),
});

export const mentorIdParamSchema = z.object({
    params: z.object({ mentorId: uuidSchema }),
});

export const mentorStudentParamSchema = z.object({
    params: z.object({ mentorId: uuidSchema, studentId: uuidSchema }),
});

export const linkSessionToMilestoneSchema = z.object({
    params: z.object({ bookingId: uuidSchema }),
    body: z
        .object({
            milestoneId: uuidSchema,
            sessionType: sessionTypeEnum.default('milestone'),
            contributesToCompletion: z.boolean().default(true),
        })
        .strict(),
});

export const updateSessionMappingSchema = z.object({
    params: z.object({ bookingId: uuidSchema }),
    body: z
        .object({
            sessionType: sessionTypeEnum.optional(),
            contributesToCompletion: z.boolean().optional(),
        })
        .strict(),
});

export const createSessionOutcomeSchema = z.object({
    params: z.object({ bookingId: uuidSchema }),
    body: z
        .object({
            mentorFeedback: z.string().trim().max(5000).optional(),
            studentFeedback: z.string().trim().max(5000).optional(),
            objectivesAchieved: z.array(z.string().trim().max(500)).optional(),
            skillsImproved: z.array(z.string().trim().max(500)).optional(),
            nextSteps: z.array(z.string().trim().max(500)).optional(),
            progressContribution: z.number().min(0).max(100).optional(),
            completionStatus: completionStatusEnum.optional(),
            sessionEffectiveness: z.number().min(1).max(5).optional(),
            recommendedFollowUp: followUpEnum.optional(),
        })
        .strict(),
});

export const createContextualBookingSchema = z.object({
    body: z
        .object({
            menteeId: uuidSchema,
            mentorId: uuidSchema,
            scheduledAt: z.string().datetime(),
            durationMinutes: z.number().min(15).max(240),
            topic: shortTextSchema,
            notes: z.string().trim().max(5000).optional(),
            milestoneId: uuidSchema.optional(),
            sessionType: sessionTypeEnum.optional(),
            contributesToCompletion: z.boolean().optional(),
        })
        .strict(),
});

export const updateHybridModeConfigSchema = z.object({
    params: z.object({ mentorId: uuidSchema }),
    body: z
        .object({
            learningPathsEnabled: z.boolean().optional(),
            individualSessionsEnabled: z.boolean().optional(),
            autoLinkSessions: z.boolean().optional(),
            defaultSessionType: sessionTypeEnum.optional(),
        })
        .strict(),
});
