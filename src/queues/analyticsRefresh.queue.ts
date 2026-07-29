import { Queue } from 'bullmq';
import { redisConnection, defaultJobOptions, QUEUE_NAMES } from './queue.config';

export const ANALYTICS_REFRESH_QUEUE = QUEUE_NAMES.ANALYTICS_REFRESH;

export interface AnalyticsRefreshJobData {
  jobType: 'analytics-refresh';
  /**
   * Which materialized view to refresh.
   * When present, the worker refreshes only this view and acquires a
   * per-view distributed lock. When absent (dispatch job), the worker
   * enqueues one per-view job for each view in ANALYTICS_VIEWS.
   */
  viewName?: string;
}

export const analyticsRefreshQueue = new Queue<AnalyticsRefreshJobData>(
  ANALYTICS_REFRESH_QUEUE,
  { connection: redisConnection, defaultJobOptions },
);
