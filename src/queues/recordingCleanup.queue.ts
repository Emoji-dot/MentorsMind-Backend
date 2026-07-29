import { Queue } from 'bullmq';
import { redisConnection, defaultJobOptions, QUEUE_NAMES } from './queue.config';

export interface RecordingCleanupJobData {
  jobType: 'recording-cleanup';
}

export const recordingCleanupQueue = new Queue<RecordingCleanupJobData>(
  QUEUE_NAMES.RECORDING_CLEANUP,
  { connection: redisConnection, defaultJobOptions },
);
