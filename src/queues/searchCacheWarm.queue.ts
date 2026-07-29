/**
 * Search Cache Warming Queue
 *
 * BullMQ queue for search cache warming jobs.
 */

import { Queue } from 'bullmq';
import { redisConfig } from '../config/redis.config';

export const searchCacheWarmQueue = new Queue('searchCacheWarm', {
  connection: redisConfig.connection ?? { host: '127.0.0.1', port: 6379 },
  defaultJobOptions: {
    removeOnComplete: 10,
    removeOnFail: 5,
  },
});
