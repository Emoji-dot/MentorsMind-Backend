import { Queue } from 'bullmq';
import { redisConnection, defaultJobOptions, QUEUE_NAMES } from './queue.config';

export interface QualityScoreJobData {
  jobType: 'quality-score-cron';
  triggeredAt: string;
}

export const qualityScoreQueue = new Queue<QualityScoreJobData>(
  QUEUE_NAMES.QUALITY_SCORE,
  { connection: redisConnection, defaultJobOptions },
);
