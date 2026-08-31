import { createManagedQueue, buildJobOptions, JobConfig } from './queue.manager';
import { QUEUE_NAMES } from './queue.config';

/** Shape of a domain event job persisted in the BullMQ outbox queue. */
export interface DomainEventJobData {
  /** ID of the aggregate that raised this event (e.g. booking UUID). */
  aggregateId: string;
  /** Aggregate root type (e.g. 'booking', 'payment', 'user'). */
  aggregateType: string;
  /** Event type string (e.g. 'booking.created'). */
  eventType: string;
  /** Unique event ID — used for idempotency / deduplication. */
  eventId: string;
  /** Monotonically-increasing aggregate version at the time of the event. */
  version: number;
  /** Arbitrary event payload. */
  data: Record<string, any>;
  /** Contextual metadata (correlationId, userId, serviceName, etc.). */
  metadata: Record<string, any>;
}

/** BullMQ queue for domain event outbox fan-out. */
export const domainEventsQueue = createManagedQueue<DomainEventJobData>(
  QUEUE_NAMES.DOMAIN_EVENTS,
);

/**
 * Enqueue a domain event for asynchronous fan-out via the EventBus.
 *
 * @param data    - Domain event payload to persist in the outbox.
 * @param options - Optional BullMQ job overrides (priority, attempts, …).
 */
export async function enqueueDomainEvent(
  data: DomainEventJobData,
  options?: Partial<JobConfig>,
): Promise<void> {
  await domainEventsQueue.add(
    options?.name ?? `domain-event:${data.eventType}`,
    data,
    buildJobOptions(options),
  );
}
