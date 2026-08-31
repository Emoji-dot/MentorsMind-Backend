import { Queue } from "bullmq";
import { redisConnection, defaultJobOptions, QUEUE_NAMES } from "./queue.config";

export const INSIGHT_GENERATION_QUEUE = QUEUE_NAMES.INSIGHT_GENERATION;

export type InsightGenerationJobType =
  | "insight-generation-dispatch"
  | "insight-generation-admin"
  | "insight-generation-user";

export interface InsightGenerationJobData {
  jobType: InsightGenerationJobType;
  /** Present when jobType === 'insight-generation-user' */
  userId?: string;
  /** DB role: admin | mentor | mentee */
  role?: string;
}

export const insightGenerationQueue = new Queue<InsightGenerationJobData>(
  INSIGHT_GENERATION_QUEUE,
  { connection: redisConnection, defaultJobOptions },
);
