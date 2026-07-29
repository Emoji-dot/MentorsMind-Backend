import { EventStoreModel, DomainEvent, Snapshot } from '../models';
import { db } from '../config/database';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export class EventStoreService {
  private static readonly SNAPSHOT_THRESHOLD = 10;

  static async publishEvent(
    aggregateId: string,
    aggregateType: string,
    eventType: string,
    data: Record<string, any>,
    metadata: { userId: string; correlationId?: string }
  ): Promise<DomainEvent | null> {
    try {
      const latestVersion = await EventStoreModel.getLatestVersion(aggregateId);
      const newVersion = latestVersion + 1;

      const event: Omit<DomainEvent, 'id'> = {
        aggregateId,
        aggregateType,
        eventType,
        version: newVersion,
        data,
        metadata: {
          userId: metadata.userId,
          timestamp: new Date(),
          correlationId: metadata.correlationId || uuidv4()
        }
      };

      const savedEvent = await EventStoreModel.append(event);
      
      if (savedEvent && newVersion % this.SNAPSHOT_THRESHOLD === 0) {
        await this.createSnapshot(aggregateId, aggregateType);
      }

      logger.info({ eventType, aggregateId, aggregateType, version: newVersion }, 'Event published successfully');
      return savedEvent;
    } catch (error) {
      logger.error({ error }, 'Failed to publish event');
      return null;
    }
  }

  static async getAggregateState(
    aggregateId: string,
    aggregateType: string,
    applyEvent: (state: Record<string, any>, event: DomainEvent) => Record<string, any>,
    initialState: Record<string, any> = {},
    toVersion?: number
  ): Promise<Record<string, any>> {
    return EventStoreModel.replay(
      aggregateId,
      aggregateType,
      applyEvent,
      initialState,
      toVersion
    );
  }

  static async createSnapshot(
    aggregateId: string,
    aggregateType: string,
    applyEvent?: (state: Record<string, any>, event: DomainEvent) => Record<string, any>,
    initialState: Record<string, any> = {}
  ): Promise<Snapshot | null> {
    try {
      const state = applyEvent 
        ? await this.getAggregateState(aggregateId, aggregateType, applyEvent, initialState)
        : {};
      
      const latestVersion = await EventStoreModel.getLatestVersion(aggregateId);

      const snapshot = await EventStoreModel.createSnapshot({
        aggregateId,
        aggregateType,
        version: latestVersion,
        data: state
      });

      logger.info({ aggregateId, aggregateType, version: latestVersion }, 'Snapshot created');
      return snapshot;
    } catch (error) {
      logger.error({ error }, 'Failed to create snapshot');
      return null;
    }
  }

  static async getEvents(aggregateId: string, fromVersion = 1, toVersion?: number): Promise<DomainEvent[]> {
    const events = await EventStoreModel.getEvents(aggregateId, fromVersion);
    if (toVersion !== undefined) {
      return events.filter(e => e.version <= toVersion);
    }
    return events;
  }

  /**
   * Atomically append an event using optimistic locking.
   *
   * Generates version = expectedVersion + 1 and inserts directly via db.query
   * so that a UNIQUE(aggregate_id, version) violation (pg code 23505) is
   * surfaced as an HTTP 409 rather than being silently swallowed by
   * EventStoreModel.append().
   *
   * @throws Error with .statusCode = 409 on concurrent-write conflict
   * @throws Error on any other database failure
   */
  static async appendWithOptimisticLock(
    aggregateId: string,
    aggregateType: string,
    eventType: string,
    data: Record<string, any>,
    metadata: { userId: string; correlationId?: string },
    expectedVersion: number
  ): Promise<DomainEvent> {
    const newVersion = expectedVersion + 1;

    const metadataFull = {
      userId: metadata.userId,
      timestamp: new Date(),
      correlationId: metadata.correlationId || uuidv4(),
    };

    const query = `
      INSERT INTO domain_events (
        aggregate_id, aggregate_type, event_type, version, data, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *;
    `;

    const values = [
      aggregateId,
      aggregateType,
      eventType,
      newVersion,
      JSON.stringify(data),
      JSON.stringify(metadataFull),
    ];

    let savedEvent: DomainEvent;
    try {
      const { rows } = await db.query(query, values);
      if (!rows[0]) {
        throw new Error('Event append returned no rows');
      }
      savedEvent = rows[0] as DomainEvent;
    } catch (error: any) {
      // pg unique-violation on (aggregate_id, version) — concurrent write detected
      if (error?.code === '23505') {
        const conflict = new Error('Optimistic lock conflict') as Error & { statusCode: number };
        conflict.statusCode = 409;
        throw conflict;
      }
      logger.error({ error }, 'appendWithOptimisticLock: failed to append event');
      throw error;
    }

    logger.info(
      { eventType, aggregateId, aggregateType, version: newVersion },
      'Event appended with optimistic lock'
    );

    // Trigger snapshot creation at every SNAPSHOT_THRESHOLD boundary
    if (newVersion % EventStoreService.SNAPSHOT_THRESHOLD === 0) {
      // Fire-and-forget; snapshot failure must not roll back the already-persisted event
      this.createSnapshot(aggregateId, aggregateType).catch(err =>
        logger.error({ err, aggregateId, aggregateType }, 'Snapshot creation failed after optimistic-lock append')
      );
    }

    return savedEvent;
  }

  static async getEventHistory(
    aggregateId: string,
    limit = 100,
    offset = 0
  ): Promise<{ events: DomainEvent[], total: number }> {
    const events = await EventStoreModel.getEvents(aggregateId);
    const total = events.length;

    return {
      events: events.slice(offset, offset + limit),
      total
    };
  }
}
