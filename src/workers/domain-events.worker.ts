import { Worker, Job } from 'bullmq';
import {
  redisConnection,
  QUEUE_NAMES,
} from '../queues/queue.config';
import { EventBus } from '../services/event-bus.service';
import { logger } from '../utils/logger.utils';
import type { DomainEventJobData } from '../queues/domain-events.queue';
import type { DomainEvent } from '../events';

/**
 * Map a `DomainEventJobData` outbox record to the `DomainEvent` shape
 * expected by `EventBus.publish()`.
 */
function todomainEvent(jobData: DomainEventJobData): DomainEvent {
  return {
    id: jobData.eventId,
    type: jobData.eventType,
    aggregateId: jobData.aggregateId,
    aggregateType: jobData.aggregateType,
    data: jobData.data,
    metadata: {
      occurredAt: jobData.metadata['occurredAt']
        ? new Date(jobData.metadata['occurredAt'] as string)
        : new Date(),
      correlationId:
        (jobData.metadata['correlationId'] as string) ?? jobData.eventId,
      causationId: jobData.metadata['causationId'] as string | undefined,
      userId: jobData.metadata['userId'] as string | undefined,
      serviceName:
        (jobData.metadata['serviceName'] as string) ?? 'mentorminds-backend',
      version: jobData.version,
    },
  };
}

async function processDomainEvent(
  job: Job<DomainEventJobData>,
): Promise<void> {
  const { eventId, eventType, aggregateId, aggregateType } = job.data;

  logger.info('[DomainEventsWorker] Processing domain event', {
    jobId: job.id,
    eventId,
    eventType,
    aggregateId,
    aggregateType,
  });

  const event = todomainEvent(job.data);
  await EventBus.publish(event);

  logger.info('[DomainEventsWorker] Domain event published to EventBus', {
    jobId: job.id,
    eventId,
    eventType,
  });
}

/** BullMQ worker that fans out domain events from the outbox to Redis pub/sub. */
export const domainEventsWorker = new Worker<DomainEventJobData>(
  QUEUE_NAMES.DOMAIN_EVENTS,
  processDomainEvent,
  {
    connection: redisConnection,
    concurrency: 10,
  },
);

domainEventsWorker.on('completed', (job) => {
  logger.info('[DomainEventsWorker] Job completed', {
    jobId: job.id,
    eventType: job.data.eventType,
    eventId: job.data.eventId,
  });
});

domainEventsWorker.on('failed', (job, err) => {
  logger.error('[DomainEventsWorker] Job failed', {
    jobId: job?.id,
    eventType: job?.data?.eventType,
    eventId: job?.data?.eventId,
    attempt: job?.attemptsMade,
    error: err.message,
  });
});

domainEventsWorker.on('error', (err) => {
  logger.error('[DomainEventsWorker] Worker error', { error: err.message });
});
