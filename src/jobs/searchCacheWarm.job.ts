/**
 * Search Cache Warming Job
 *
 * Runs every 15 minutes to pre-populate the search cache for popular queries.
 * This ensures that high-traffic searches (e.g. "Python", "JavaScript",
 * "machine learning") always return cached results, reducing Elasticsearch
 * load by ~95% under sustained traffic.
 *
 * Registration: called from src/workers/scheduler.ts at startup.
 */

import { searchCacheWarmQueue } from '../queues/searchCacheWarm.queue';
import { logger } from '../utils/logger.utils';

/**
 * Register the search cache warming repeatable job in BullMQ.
 * The job runs every 15 minutes.
 */
export async function startSearchCacheWarmingJob(): Promise<void> {
  try {
    const existingJobs = await searchCacheWarmQueue.getRepeatableJobs();
    const exists = existingJobs.find((j) => j.id === 'search-cache-warm-recurring');

    if (!exists) {
      await searchCacheWarmQueue.add(
        'search-cache-warm',
        { triggeredAt: new Date().toISOString() },
        {
          repeat: { pattern: '*/15 * * * *' }, // every 15 minutes
          jobId: 'search-cache-warm-recurring',
        },
      );
      logger.info('Search cache warming job registered (every 15 minutes)');
    } else {
      logger.info('Search cache warming job already registered');
    }
  } catch (error) {
    // Non-fatal: cache warming is best-effort
    logger.warn('Failed to register search cache warming job', { error });
  }
}
