import { Worker, Job } from 'bullmq';
import { redisConnection, QUEUE_NAMES } from '../queues/queue.config';
import { RecordingCleanupJobData } from '../queues/recordingCleanup.queue';
import { runRecordingCleanupJob } from '../jobs/recordingCleanup.job';
import { logger } from '../utils/logger.utils';

async function processRecordingCleanupJob(
  job: Job<RecordingCleanupJobData>,
): Promise<void> {
  logger.info('[RecordingCleanupWorker] Running cleanup job', { jobId: job.id });
  const report = await runRecordingCleanupJob();
  logger.info('[RecordingCleanupWorker] Cleanup report', { jobId: job.id, report });
}

export const recordingCleanupWorker = new Worker<RecordingCleanupJobData>(
  QUEUE_NAMES.RECORDING_CLEANUP,
  processRecordingCleanupJob,
  { connection: redisConnection, concurrency: 1 },
);

recordingCleanupWorker.on('completed', (job) => {
  logger.info('[RecordingCleanupWorker] Job completed', { jobId: job.id });
});

recordingCleanupWorker.on('failed', (job, err) => {
  logger.error('[RecordingCleanupWorker] Job failed', {
    jobId: job?.id,
    attempt: job?.attemptsMade,
    error: err.message,
  });
});

recordingCleanupWorker.on('error', (err) => {
  logger.error('[RecordingCleanupWorker] Worker error', { error: err.message });
});
