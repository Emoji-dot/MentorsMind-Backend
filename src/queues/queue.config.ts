/**
 * Queue config — re-exported from src/config/queue.ts (single source of truth).
 * Kept here for backward-compatibility with existing queue/worker imports.
 */
export {
  redisConnection,
  defaultJobOptions,
  QUEUE_NAMES,
  CONCURRENCY,
  JOB_RATE_LIMITS,
  QUEUE_PRIORITIES,
  JobConfig,
  JobType,
  JobBackoffConfig,
  JobRateLimit,
} from "../config/queue";
export type { QueueName } from "../config/queue";

// Backward-compat alias used by some workers
export { redisConnection as queueConnection } from "../config/queue";
