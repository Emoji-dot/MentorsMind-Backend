import { z } from 'zod';
import { uuidSchema } from './common.schemas';

const timeframeQuery = z.object({
    timeframe: z.enum(['week', 'month', 'quarter', 'year', 'all']).optional(),
});

export const pathAnalyticsSchema = z.object({
    params: z.object({ pathId: uuidSchema }),
    query: timeframeQuery,
});

export const pathMilestonesSchema = z.object({
    params: z.object({ pathId: uuidSchema }),
    query: timeframeQuery,
});

export const pathTrendsSchema = z.object({
    params: z.object({ pathId: uuidSchema }),
    query: timeframeQuery,
});

export const pathBottlenecksSchema = z.object({
    params: z.object({ pathId: uuidSchema }),
    query: timeframeQuery,
});

export const studentProfileSchema = z.object({
    params: z.object({ studentId: uuidSchema }),
    query: z.object({ pathId: uuidSchema.optional() }),
});

export const studentPathInsightsSchema = z.object({
    params: z.object({ studentId: uuidSchema, pathId: uuidSchema }),
});

export const studentPathComparisonSchema = z.object({
    params: z.object({ studentId: uuidSchema, pathId: uuidSchema }),
});

export const mentorDashboardSchema = z.object({
    params: z.object({ mentorId: uuidSchema }),
    query: timeframeQuery,
});
