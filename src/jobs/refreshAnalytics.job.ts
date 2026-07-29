/**
 * Analytics Refresh Job — pure job scheduler / enqueuer
 *
 * This file's ONLY responsibility is to place a dispatch job on the
 * analyticsRefreshQueue. It never calls REFRESH MATERIALIZED VIEW directly.
 *
 * ┌─────────────────────────────────────────────────────┐
 * │              Three-component architecture            │
 * │                                                     │
 * │  refreshAnalytics.job.ts  (you are here)            │
 * │  ↓  enqueues dispatch job (no viewName)             │
 * │                                                     │
 * │  analyticsRefresh.worker.ts                         │
 * │  • dispatch mode (no viewName):                     │
 * │    → enqueues one per-view job per ANALYTICS_VIEWS  │
 * │  • per-view mode (viewName set):                    │
 * │    → acquires Redis SET NX EX lock for that view    │
 * │    → calls REFRESH MATERIALIZED VIEW CONCURRENTLY   │
 * │    → writes analytics:refresh:state:{view} to Redis │
 * │    → invalidates scoped cache keys                  │
 * │                                                     │
 * │  analytics-pipeline.worker.ts                       │
 * │  • consumes Postgres LISTEN/NOTIFY domain events    │
 * │  • updates Redis counters / invalidates caches      │
 * │  • never touches REFRESH MATERIALIZED VIEW          │
 * └─────────────────────────────────────────────────────┘
 *
 * The BullMQ scheduler (scheduler.ts) enqueues a dispatch job every 15 minutes
 * via the 'analytics-refresh-recurring' repeatable job.
 */

import { analyticsRefreshQueue } from '../queues/analyticsRefresh.queue';
import { logger } from '../utils/logger.utils';

/**
 * Enqueue a dispatch job for the analytics refresh worker.
 * The worker will break this into per-view jobs with individual Redis locks.
 *
 * Can also be called directly (e.g. from an admin script or test) to trigger
 * an immediate refresh outside of the scheduled cron.
 */
export async function runAnalyticsRefreshJob(): Promise<void> {
  const job = await analyticsRefreshQueue.add(
    'analytics-refresh-dispatch',
    { jobType: 'analytics-refresh' }, // no viewName → worker enters dispatch mode
    {
      jobId: 'analytics-refresh-dispatch-dedup',
      attempts: 1, // dispatch step itself is cheap; per-view jobs handle retries
    },
  );

  logger.info('[AnalyticsRefreshJob] Dispatch job enqueued', { jobId: job.id });
}
