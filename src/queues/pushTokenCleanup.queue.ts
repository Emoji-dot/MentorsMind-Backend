import { Queue } from "bullmq";
import { redisConnection, defaultJobOptions } from "./queue.config";

export const PUSH_TOKEN_CLEANUP_QUEUE = "push-token-cleanup-queue";

export interface PushTokenCleanupJobData {
  jobType: "push-token-cleanup";
}

export const pushTokenCleanupQueue = new Queue<PushTokenCleanupJobData>(
  PUSH_TOKEN_CLEANUP_QUEUE,
  { connection: redisConnection, defaultJobOptions },
);
