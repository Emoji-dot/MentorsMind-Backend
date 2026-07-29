import { Queue } from 'bullmq';
import {
  redisConnection,
  defaultJobOptions,
  QUEUE_NAMES,
} from '../config/queue';

export interface SessionNoShowJobData {
  bookingId: string;
  mentorId: string;
  menteeId: string;
  scheduledStart: Date | string;
  gracePeriodMinutes: number;
}

export const sessionNoShowQueue = new Queue<SessionNoShowJobData>(
  QUEUE_NAMES.SESSION_NO_SHOW,
  {
    connection: redisConnection,
    defaultJobOptions,
  }
);

/**
 * Schedule a no-show detection check.
 * Job runs at scheduled_start + grace_period_minutes.
 * Uses jobId deduplication so re-scheduling is idempotent.
 * 
 * @param data - Booking and participant information
 */
export async function scheduleNoShowCheck(
  data: SessionNoShowJobData
): Promise<void> {
  const scheduledStart = new Date(data.scheduledStart);
  const checkTime = new Date(
    scheduledStart.getTime() + data.gracePeriodMinutes * 60 * 1000
  );
  const delay = checkTime.getTime() - Date.now();

  // Only schedule if the check time is in the future
  if (delay > 0) {
    await sessionNoShowQueue.add('check-no-show', data, {
      jobId: `no-show-check:${data.bookingId}`,
      delay,
    });
  }
}

/**
 * Cancel a pending no-show check (e.g. mentor joined in time).
 * Idempotent - safe to call even if job doesn't exist.
 * 
 * @param bookingId - The booking ID
 */
export async function cancelNoShowCheck(bookingId: string): Promise<void> {
  const job = await sessionNoShowQueue.getJob(`no-show-check:${bookingId}`);
  if (!job) {
    return;
  }

  const state = await job.getState();
  
  // Remove if job is still waiting
  if (['waiting', 'delayed', 'paused'].includes(state)) {
    await job.remove();
  }
}
