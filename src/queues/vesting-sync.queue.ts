import { Queue } from 'bullmq';
import {
  redisConnection,
  defaultJobOptions,
  QUEUE_NAMES,
} from './queue.config';
import type { VestingSyncJobData } from '../workers/vesting-sync.worker';

/**
 * Queue for vesting schedule sync jobs
 * Syncs PostgreSQL mirror table with on-chain vesting contract data
 */
export const vestingSyncQueue = new Queue<VestingSyncJobData>(
  QUEUE_NAMES.VESTING_SYNC,
  {
    connection: redisConnection,
    defaultJobOptions: {
      ...defaultJobOptions,
      attempts: 3, // Fewer retries for sync operations
      backoff: {
        type: 'exponential',
        delay: 5000, // 5s → 10s → 20s
      },
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 100 },
    },
  },
);

/**
 * Schedule a sync job for all active vesting schedules
 * Should be called by a cron job every 6 hours
 */
export async function scheduleVestingSync(): Promise<void> {
  await vestingSyncQueue.add(
    'sync-all-schedules',
    {},
    {
      jobId: `vesting-sync-${Date.now()}`,
      removeOnComplete: true,
    },
  );
}

/**
 * Schedule a sync job for a specific vesting schedule
 * Can be called after creating or claiming from a schedule
 */
export async function scheduleVestingScheduleSync(
  scheduleId: number,
): Promise<void> {
  await vestingSyncQueue.add(
    'sync-schedule',
    { scheduleId },
    {
      jobId: `vesting-sync-schedule-${scheduleId}-${Date.now()}`,
      removeOnComplete: true,
    },
  );
}

/**
 * Schedule periodic vesting sync (every 6 hours)
 * This should be registered in the scheduler
 */
export async function setupVestingSyncSchedule(): Promise<void> {
  // Remove any existing repeatable jobs
  const repeatableJobs = await vestingSyncQueue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    if (job.name === 'periodic-vesting-sync') {
      await vestingSyncQueue.removeRepeatableByKey(job.key);
    }
  }

  // Add new repeatable job (every 6 hours)
  await vestingSyncQueue.add(
    'periodic-vesting-sync',
    {},
    {
      repeat: {
        pattern: '0 */6 * * *', // Every 6 hours at minute 0
      },
      jobId: 'periodic-vesting-sync',
    },
  );
}
