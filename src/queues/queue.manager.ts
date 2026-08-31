import { Queue, QueueEvents, JobsOptions } from 'bullmq';
import { CacheService } from '../services/cache.service';
import { redisConnection, defaultJobOptions } from '../config/queue';

type QueueJobOptions = JobsOptions & {
  timeout?: number;
  removeOnComplete?: boolean | { count: number };
  removeOnFail?: boolean | { count: number };
};

export interface JobBackoffConfig {
  type: 'fixed' | 'exponential';
  delay: number;
}

export interface JobConfig {
  name: string;
  priority?: number;
  attempts?: number;
  backoff?: JobBackoffConfig;
  timeout?: number;
  removeOnComplete?: boolean | { count: number };
  removeOnFail?: boolean | { count: number };
}

export enum JobType {
  EMAIL = 'email',
  PAYMENT = 'payment',
  NOTIFICATION = 'notification',
  REPORT = 'report',
  ANALYTICS = 'analytics',
  BLOCKCHAIN = 'blockchain',
}

export interface JobResult {
  status: 'completed' | 'failed';
  result?: unknown;
  error?: string;
}

export function jobResultCacheKey(queueName: string, jobId: string): string {
  return `job-result:${queueName}:${jobId}`;
}

export async function getCachedJobResult(
  queueName: string,
  jobId: string,
): Promise<JobResult | null> {
  return CacheService.get<JobResult>(jobResultCacheKey(queueName, jobId));
}

export function createManagedQueue<T>(
  name: string,
  options?: {
    defaultJobOptions?: JobsOptions;
    limiter?: { max: number; duration: number };
  },
): Queue<T> {
  const queueOptions: any = {
    connection: redisConnection,
    defaultJobOptions: options?.defaultJobOptions ?? defaultJobOptions,
  };

  if (options?.limiter) {
    queueOptions.limiter = options.limiter;
  }

  return new Queue<T>(name, queueOptions);
}

export function buildJobOptions(config?: Partial<JobConfig>): QueueJobOptions {
  const options: QueueJobOptions = {} as QueueJobOptions;

  if (!config) {
    return options;
  }

  if (config.priority !== undefined) {
    options.priority = config.priority;
  }
  if (config.attempts !== undefined) {
    options.attempts = config.attempts;
  }
  if (config.backoff !== undefined) {
    options.backoff = config.backoff;
  }
  if (config.timeout !== undefined) {
    options.timeout = config.timeout;
  }
  if (config.removeOnComplete !== undefined) {
    options.removeOnComplete = config.removeOnComplete;
  }
  if (config.removeOnFail !== undefined) {
    options.removeOnFail = config.removeOnFail;
  }

  return options;
}

export function enableJobResultCache<T>(queue: Queue<T>, ttlSeconds = 3600): QueueEvents {
  const events = new QueueEvents(queue.name, { connection: redisConnection });

  events.on('completed', async ({ jobId, returnvalue }) => {
    if (!jobId) return;
    await CacheService.set<JobResult>(
      jobResultCacheKey(queue.name, jobId),
      { status: 'completed', result: returnvalue },
      ttlSeconds,
    );
  });

  events.on('failed', async ({ jobId, failedReason }) => {
    if (!jobId) return;
    await CacheService.set<JobResult>(
      jobResultCacheKey(queue.name, jobId),
      { status: 'failed', error: failedReason },
      ttlSeconds,
    );
  });

  return events;
}
