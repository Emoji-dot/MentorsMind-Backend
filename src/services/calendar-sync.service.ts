import { logger } from "../utils/logger.utils";
import { CalendarEvent } from "./smart-calendar.service";

export interface SyncStatus {
  lastSync: Date;
  status: "success" | "failed" | "syncing";
  eventsAdded: number;
  eventsUpdated: number;
  eventsDeleted: number;
  errors?: string[];
}

export class CalendarSyncService {
  private syncStatus: Map<string, SyncStatus> = new Map();
  private syncIntervals: Map<string, NodeJS.Timeout> = new Map();

  async startSync(userId: string, intervalMinutes: number = 15): Promise<void> {
    logger.info({ userId, intervalMinutes }, "Starting calendar sync");

    const interval = setInterval(
      async () => {
        await this.performSync(userId);
      },
      intervalMinutes * 60 * 1000,
    );

    this.syncIntervals.set(userId, interval);
    await this.performSync(userId);
  }

  async stopSync(userId: string): Promise<void> {
    const interval = this.syncIntervals.get(userId);
    if (interval) {
      clearInterval(interval);
      this.syncIntervals.delete(userId);
      logger.info({ userId }, "Stopped calendar sync");
    }
  }

  /**
   * Stops all active sync intervals. Called during graceful shutdown to
   * ensure no orphaned timers remain after SIGTERM/SIGINT is received.
   */
  stopAllSyncs(): void {
    const count = this.syncIntervals.size;
    this.syncIntervals.forEach((interval) => clearInterval(interval));
    this.syncIntervals.clear();
    logger.info({ count }, 'Calendar sync intervals stopped');
  }

  async performSync(userId: string): Promise<SyncStatus> {
    logger.debug({ userId }, "Performing calendar sync");

    try {
      this.syncStatus.set(userId, {
        lastSync: new Date(),
        status: "syncing",
        eventsAdded: 0,
        eventsUpdated: 0,
        eventsDeleted: 0,
      });

      // Fetch events from provider
      const events = await this.fetchProviderEvents(userId);

      // Sync to local storage
      const result = await this.syncToLocal(userId, events);

      const status: SyncStatus = {
        lastSync: new Date(),
        status: "success",
        ...result,
      };

      this.syncStatus.set(userId, status);
      return status;
    } catch (error: any) {
      logger.error({ userId, error }, "Calendar sync failed");

      const status: SyncStatus = {
        lastSync: new Date(),
        status: "failed",
        eventsAdded: 0,
        eventsUpdated: 0,
        eventsDeleted: 0,
        errors: [error.message],
      };

      this.syncStatus.set(userId, status);
      return status;
    }
  }

  async getSyncStatus(userId: string): Promise<SyncStatus | null> {
    return this.syncStatus.get(userId) || null;
  }

  async forceSyncNow(userId: string): Promise<SyncStatus> {
    return await this.performSync(userId);
  }

  async resolveConflict(
    localEvent: CalendarEvent,
    remoteEvent: CalendarEvent,
  ): Promise<CalendarEvent> {
    // Use most recent update
    if (!localEvent) return remoteEvent;
    if (!remoteEvent) return localEvent;

    // In a real implementation, compare timestamps
    return remoteEvent;
  }

  private async fetchProviderEvents(userId: string): Promise<CalendarEvent[]> {
    // Placeholder implementation
    return [];
  }

  private async syncToLocal(
    userId: string,
    events: CalendarEvent[],
  ): Promise<Omit<SyncStatus, "lastSync" | "status">> {
    let eventsAdded = 0;
    let eventsUpdated = 0;
    let eventsDeleted = 0;

    // Check each event for duplicates
    for (const event of events) {
      const exists = await this.eventExists(userId, event.id);
      if (exists) {
        eventsUpdated++;
      } else {
        eventsAdded++;
        // Code to insert event would go here
      }
    }

    return { eventsAdded, eventsUpdated, eventsDeleted };
  }

  private async eventExists(userId: string, eventId: string): Promise<boolean> {
    // Query the calendar_sync_events table to check if event already exists
    const { rows } = await db.query(
      `SELECT id FROM calendar_sync_events WHERE user_id = $1 AND external_id = $2`,
      [userId, eventId],
    );
    return rows.length > 0;
  }
}

export const calendarSyncService = new CalendarSyncService();

/**
 * Standalone export for use in server.ts shutdown sequence.
 * Delegates to the singleton instance's stopAllSyncs() method.
 */
export function stopAllSyncs(): void {
  calendarSyncService.stopAllSyncs();
}
