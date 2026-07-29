/**
 * Analytics Refresh Worker
 *
 * Processes individual view-refresh jobs from analyticsRefreshQueue.
 *
 * For each job:
 *  1. Acquire a per-view Redis distributed lock (SET NX EX 600).
 *     If lock is already held → skip silently (another instance is refreshing).
 *  2. Write refresh state: analytics:refresh:state:{viewName} = refreshing.
 *  3. Call the appropriate DB refresh function.
 *  4. Invalidate view-scoped cache keys.
 *  5. Update state to idle + record lastRefreshedAt.
 *  6. Release the lock.
 *
 * Safety: the lock TTL (10 min) is longer than any expected refresh duration,
 * so a crash mid-refresh will auto-expire the lock rather than block forever.
 */

import { Worker, Job } from 'bullmq';
import { redisConnection } from '../queues/queue.config';
import {
  ANALYTICS_REFRESH_QUEUE,
  AnalyticsRefreshJobData,
  analyticsRefreshQueue,
} from '../queues/analyticsRefresh.queue';
import { CacheService } from '../services/cache.service';
import { logger } from '../utils/logger.utils';
import { hostname } from 'os';
import pool from '../config/database';
import IORedis from 'ioredis';
import config from '../config';

// ---------------------------------------------------------------------------
// View registry — single source of truth for all materialized views.
// The job scheduler reads this to enqueue one job per entry.
// ---------------------------------------------------------------------------

export interface ViewDefinition {
  /** PostgreSQL materialized view name */
  name: string;
  /** DB function that refreshes this view (CONCURRENTLY where safe) */
  refreshFn: string;
  /** Cache key prefix to invalidate after refresh */
  cachePattern: string;
}

export const ANALYTICS_VIEWS: ViewDefinition[] = [
  {
    name: 'mv_daily_revenue',
    refreshFn: 'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_revenue',
    cachePattern: 'analytics:revenue:*',
  },
  {
    name: 'mv_daily_users',
    refreshFn: 'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_users',
    cachePattern: 'analytics:users:*',
  },
  {
    name: 'mv_session_stats',
    refreshFn: 'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_session_stats',
    cachePattern: 'analytics:sessions:*',
  },
  {
    name: 'mv_top_mentors',
    refreshFn: 'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_top_mentors',
    cachePattern: 'analytics:mentors:*',
  },
  {
    name: 'mv_asset_distribution',
    refreshFn: 'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_asset_distribution',
    cachePattern: 'analytics:asset-distribution*',
  },
];

// ---------------------------------------------------------------------------
// Redis lock / state helpers
// ---------------------------------------------------------------------------

/** Lock TTL: 10 minutes. Long enough to cover any realistic refresh. */
const LOCK_TTL_SECONDS = 600;

/** State key TTL: 24 hours. Allows the status endpoint to read history. */
const STATE_TTL_SECONDS = 86_400;

/** Unique identifier for this process instance */
const INSTANCE_ID = `${hostname()}-${process.pid}`;

export interface ViewRefreshState {
  viewName: string;
  status: 'idle' | 'refreshing' | 'failed';
  lastRefreshedAt: string | null;
  lastFailedAt: string | null;
  lastError: string | null;
  refresher: string | null;
  durationMs: number | null;
}

// Lazy Redis client for lock operations (uses raw ioredis, not the CacheService
// wrapper, so we can use SET NX EX atomically).
let _lockRedis: IORedis | null = null;

function getLockClient(): IORedis {
  if (_lockRedis) return _lockRedis;

  const redisUrl = config.redis.url || 'redis://localhost:6379';
  const url = new URL(redisUrl);

  _lockRedis = new IORedis({
    host: url.hostname,
    port: parseInt(url.port, 10) || 6379,
    password: url.password || undefined,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: true,
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
  });

  _lockRedis.on('error', (err) => {
    logger.warn('[AnalyticsRefreshWorker] Redis lock client error', {
      error: err.message,
    });
  });

  return _lockRedis;
}

function lockKey(viewName: string): string {
  return `analytics:refresh:lock:${viewName}`;
}

function stateKey(viewName: string): string {
  return `analytics:refresh:state:${viewName}`;
}

/**
 * Try to acquire the distributed lock.
 * Returns true if acquired, false if already held.
 */
async function acquireLock(viewName: string): Promise<boolean> {
  try {
    const redis = getLockClient();
    const result = await redis.set(
      lockKey(viewName),
      INSTANCE_ID,
      'EX',
      LOCK_TTL_SECONDS,
      'NX',
    );
    return result === 'OK';
  } catch (err) {
    // Redis unavailable — allow the refresh to proceed (single-instance safe)
    logger.warn('[AnalyticsRefreshWorker] Could not acquire lock, proceeding anyway', {
      viewName,
      error: err instanceof Error ? err.message : String(err),
    });
    return true;
  }
}

/**
 * Release the lock — only if we own it (avoids releasing another instance's lock
 * if this instance was slow and the lock TTL expired and was re-acquired).
 */
async function releaseLock(viewName: string): Promise<void> {
  try {
    const redis = getLockClient();
    const current = await redis.get(lockKey(viewName));
    if (current === INSTANCE_ID) {
      await redis.del(lockKey(viewName));
    }
  } catch (err) {
    logger.warn('[AnalyticsRefreshWorker] Could not release lock', {
      viewName,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function writeState(state: ViewRefreshState): Promise<void> {
  try {
    await CacheService.set(stateKey(state.viewName), state, STATE_TTL_SECONDS);
  } catch (err) {
    logger.warn('[AnalyticsRefreshWorker] Could not write state', {
      viewName: state.viewName,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function readViewState(viewName: string): Promise<ViewRefreshState | null> {
  return CacheService.get<ViewRefreshState>(stateKey(viewName));
}

export async function readAllViewStates(): Promise<ViewRefreshState[]> {
  const states = await Promise.all(
    ANALYTICS_VIEWS.map((v) => readViewState(v.name)),
  );
  return states.map((s, i) => {
    if (s) return s;
    // Return a default "never refreshed" state for views with no record
    return {
      viewName: ANALYTICS_VIEWS[i].name,
      status: 'idle' as const,
      lastRefreshedAt: null,
      lastFailedAt: null,
      lastError: null,
      refresher: null,
      durationMs: null,
    };
  });
}

// ---------------------------------------------------------------------------
// Core refresh logic
// ---------------------------------------------------------------------------

async function refreshView(view: ViewDefinition): Promise<void> {
  const acquired = await acquireLock(view.name);

  if (!acquired) {
    logger.info('[AnalyticsRefreshWorker] Lock held by another instance — skipping', {
      viewName: view.name,
    });
    return;
  }

  const startedAt = Date.now();

  await writeState({
    viewName: view.name,
    status: 'refreshing',
    lastRefreshedAt: null,
    lastFailedAt: null,
    lastError: null,
    refresher: INSTANCE_ID,
    durationMs: null,
  });

  try {
    await pool.query(view.refreshFn);

    const durationMs = Date.now() - startedAt;

    await writeState({
      viewName: view.name,
      status: 'idle',
      lastRefreshedAt: new Date().toISOString(),
      lastFailedAt: null,
      lastError: null,
      refresher: INSTANCE_ID,
      durationMs,
    });

    // Invalidate only the cache keys for this specific view
    await CacheService.invalidatePattern(view.cachePattern);
    // Always invalidate the dashboard composite cache
    await CacheService.invalidatePattern('analytics:dashboard:*');

    logger.info('[AnalyticsRefreshWorker] View refreshed', {
      viewName: view.name,
      durationMs,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    await writeState({
      viewName: view.name,
      status: 'failed',
      lastRefreshedAt: null,
      lastFailedAt: new Date().toISOString(),
      lastError: errorMsg,
      refresher: INSTANCE_ID,
      durationMs: Date.now() - startedAt,
    });

    logger.error('[AnalyticsRefreshWorker] View refresh failed', {
      viewName: view.name,
      error: errorMsg,
    });

    throw err; // Let BullMQ handle retry
  } finally {
    await releaseLock(view.name);
  }
}

// ---------------------------------------------------------------------------
// BullMQ worker
// ---------------------------------------------------------------------------

async function processAnalyticsRefreshJob(
  job: Job<AnalyticsRefreshJobData>,
): Promise<void> {
  const { viewName } = job.data;

  if (viewName) {
    // Per-view job: acquire lock and refresh exactly this view
    const view = ANALYTICS_VIEWS.find((v) => v.name === viewName);
    if (!view) {
      logger.warn('[AnalyticsRefreshWorker] Unknown view requested', { viewName, jobId: job.id });
      return;
    }
    logger.info('[AnalyticsRefreshWorker] Processing view refresh', { viewName, jobId: job.id });
    await refreshView(view);
  } else {
    // Dispatch job: enqueue one per-view job for each view.
    // The per-view jobs will be picked up by this same worker (concurrency=3)
    // with individual distributed locks — no two instances ever refresh the
    // same view concurrently.
    logger.info('[AnalyticsRefreshWorker] Dispatching per-view refresh jobs', { jobId: job.id });

    for (const view of ANALYTICS_VIEWS) {
      await analyticsRefreshQueue.add(
        `refresh-view-${view.name}`,
        { jobType: 'analytics-refresh', viewName: view.name },
        {
          jobId: `analytics-refresh-${view.name}-dedup`,
          attempts: 2,
          backoff: { type: 'fixed', delay: 30_000 },
        },
      );
    }

    logger.info('[AnalyticsRefreshWorker] Per-view jobs enqueued', {
      count: ANALYTICS_VIEWS.length,
      jobId: job.id,
    });
  }
}

export const analyticsRefreshWorker = new Worker<AnalyticsRefreshJobData>(
  ANALYTICS_REFRESH_QUEUE,
  processAnalyticsRefreshJob,
  {
    connection: redisConnection,
    // Allow multiple views to refresh in parallel (each guards itself with its
    // own distributed lock, so concurrent jobs for different views are safe).
    concurrency: 3,
  },
);

analyticsRefreshWorker.on('completed', (job) => {
  logger.info('[AnalyticsRefreshWorker] Job completed', {
    jobId: job.id,
    viewName: job.data.viewName ?? 'all',
  });
});

analyticsRefreshWorker.on('failed', (job, err) => {
  logger.error('[AnalyticsRefreshWorker] Job failed', {
    jobId: job?.id,
    viewName: job?.data.viewName ?? 'all',
    attempt: job?.attemptsMade,
    error: err.message,
  });
});

analyticsRefreshWorker.on('error', (err) => {
  logger.error('[AnalyticsRefreshWorker] Worker error', { error: err.message });
});
