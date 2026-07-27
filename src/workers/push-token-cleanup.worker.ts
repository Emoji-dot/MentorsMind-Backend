import { Worker, Job } from "bullmq";
import { redisConnection } from "../queues/queue.config";
import {
  PUSH_TOKEN_CLEANUP_QUEUE,
  PushTokenCleanupJobData,
} from "../queues/pushTokenCleanup.queue";
import { runPushTokenCleanupJob } from "../jobs/pushTokenCleanup.job";
import { logger } from "../utils/logger.utils";

async function processPushTokenCleanupJob(
  job: Job<PushTokenCleanupJobData>,
): Promise<void> {
  logger.info("[PushTokenCleanupWorker] Running push token cleanup", {
    jobId: job.id,
  });
  await runPushTokenCleanupJob();
}

export const pushTokenCleanupWorker = new Worker<PushTokenCleanupJobData>(
  PUSH_TOKEN_CLEANUP_QUEUE,
  processPushTokenCleanupJob,
  { connection: redisConnection, concurrency: 1 },
);

pushTokenCleanupWorker.on("completed", (job) => {
  logger.info("[PushTokenCleanupWorker] Job completed", { jobId: job.id });
});

pushTokenCleanupWorker.on("failed", (job, err) => {
  logger.error("[PushTokenCleanupWorker] Job failed", {
    jobId: job?.id,
    attempt: job?.attemptsMade,
    error: err.message,
  });
});

pushTokenCleanupWorker.on("error", (err) => {
  logger.error("[PushTokenCleanupWorker] Worker error", { error: err.message });
});
