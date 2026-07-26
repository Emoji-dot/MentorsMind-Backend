/**
 * OfflineSyncService
 *
 * Orchestrates the full sync cycle when a mobile client reconnects.
 *
 * Sync flow:
 *  1. Client reconnects (Socket.IO or HTTP).
 *  2. Client sends its local sync state (domain → lastSyncedAt).
 *  3. Server computes delta updates for each domain.
 *  4. Server processes the client's queued offline actions.
 *  5. Server returns delta data + action results in a single response.
 *  6. Client applies deltas and resolves any conflicts.
 */

import { OfflineCacheService } from './offline-cache.service';
import { OfflineQueueService, EnqueueInput, ProcessResult } from './offline-queue.service';
import { SocketService } from './socket.service';
import { logger } from '../utils/logger.utils';
import pool from '../config/database';
import {
  VectorClock,
  compareVectorClocks,
  mergeVectorClocks,
  incrementClock,
} from '../utils/vector-clock.utils';

// ─── Vector-clock batch sync (issue #689) ─────────────────────────────────────

export type SyncEntityType = 'learning_goals' | 'session_notes' | 'booking_notes';
export type SyncOperation = 'create' | 'update' | 'delete';

export interface SyncChange {
  entityType: SyncEntityType;
  entityId: string;
  operation: SyncOperation;
  vectorClock: VectorClock;
  payload: Record<string, unknown>;
}

export interface SyncConflict {
  entityType: SyncEntityType;
  entityId: string;
  clientVersion: { vectorClock: VectorClock; payload: Record<string, unknown> };
  serverVersion: { vectorClock: VectorClock; payload: Record<string, unknown> };
  resolutionStrategy: 'server-wins' | 'merge' | 'last-write-wins';
}

export interface SyncChangesResult {
  cursor: number;
  applied: Array<{ entityType: SyncEntityType; entityId: string; vectorClock: VectorClock }>;
  conflicts: SyncConflict[];
}

const ENTITY_TABLE: Record<SyncEntityType, string> = {
  learning_goals: 'learner_goals',
  session_notes: 'session_notes',
  booking_notes: 'booking_notes',
};

/** server-wins | merge (append-only) | last-write-wins (diff shown to user) */
const RESOLUTION_STRATEGY: Record<SyncEntityType, SyncConflict['resolutionStrategy']> = {
  learning_goals: 'server-wins',
  session_notes: 'merge',
  booking_notes: 'last-write-wins',
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ClientSyncState {
  /** domain → ISO timestamp of last successful sync */
  domains: Record<string, string>;
}

export interface SyncRequest {
  userId: string;
  syncState: ClientSyncState;
  actions: EnqueueInput[];
}

export interface SyncResponse {
  syncedAt: string;
  deltas: Record<
    string,
    {
      records: unknown[];
      deletedIds: string[];
      newEtag: string;
      recordCount: number;
    }
  >;
  actionResults: ProcessResult[];
  conflicts: ProcessResult[];
  summary: {
    domainsUpdated: number;
    actionsProcessed: number;
    actionsCompleted: number;
    actionsFailed: number;
    conflictsDetected: number;
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const OfflineSyncService = {
  /**
   * Execute a full sync cycle for a reconnecting client.
   */
  async sync(request: SyncRequest): Promise<SyncResponse> {
    const { userId, syncState, actions } = request;
    const syncedAt = new Date().toISOString();

    logger.info('OfflineSyncService: sync started', {
      userId,
      domains: Object.keys(syncState.domains),
      actionCount: actions.length,
    });

    // Step 1: Persist offline actions
    if (actions.length > 0) {
      await OfflineQueueService.enqueueBatch(actions);
    }

    // Step 2: Compute delta updates for each domain in parallel
    const deltaEntries = await Promise.all(
      Object.entries(syncState.domains).map(async ([domain, since]) => {
        try {
          const delta = await OfflineCacheService.getDelta(userId, domain, since);
          return [domain, delta] as const;
        } catch (err: any) {
          logger.warn('OfflineSyncService: delta fetch failed', {
            userId,
            domain,
            error: err.message,
          });
          return [domain, null] as const;
        }
      }),
    );

    const deltas: SyncResponse['deltas'] = {};
    for (const [domain, delta] of deltaEntries) {
      if (delta) {
        deltas[domain] = {
          records: delta.records,
          deletedIds: delta.deletedIds,
          newEtag: delta.newEtag,
          recordCount: delta.recordCount,
        };
      }
    }

    // Step 3: Process queued actions
    const actionResults = await OfflineQueueService.processQueue(userId);

    const completed = actionResults.filter((r) => r.status === 'completed');
    const failed = actionResults.filter((r) => r.status === 'failed');
    const conflicts = actionResults.filter((r) => r.status === 'conflict');

    // Step 4: Invalidate snapshot cache if any actions succeeded
    if (completed.length > 0) {
      await OfflineCacheService.invalidateSnapshot(userId);
    }

    // Step 5: Notify client via Socket.IO
    SocketService.emitToUser(userId, 'offline:sync:complete', {
      syncedAt,
      actionsCompleted: completed.length,
      actionsFailed: failed.length,
      conflictsDetected: conflicts.length,
      domainsUpdated: Object.keys(deltas).length,
    });

    // Emit individual conflict events so the client can prompt the user
    for (const conflict of conflicts) {
      SocketService.emitToUser(userId, 'offline:conflict', {
        clientKey: conflict.clientKey,
        conflictData: conflict.conflictData,
      });
    }

    const summary = {
      domainsUpdated: Object.keys(deltas).length,
      actionsProcessed: actionResults.length,
      actionsCompleted: completed.length,
      actionsFailed: failed.length,
      conflictsDetected: conflicts.length,
    };

    logger.info('OfflineSyncService: sync complete', { userId, ...summary });

    return { syncedAt, deltas, actionResults, conflicts, summary };
  },

  /**
   * Lightweight sync triggered when a Socket.IO client reconnects.
   * Processes any pending queue items and emits results via Socket.IO.
   * The client should call GET /api/v1/offline/delta for domain data.
   */
  async onSocketReconnect(userId: string): Promise<void> {
    logger.info('OfflineSyncService: socket reconnect sync', { userId });

    try {
      const actionResults = await OfflineQueueService.processQueue(userId);
      if (actionResults.length === 0) return;

      const completed = actionResults.filter((r) => r.status === 'completed');
      const failed = actionResults.filter((r) => r.status === 'failed');
      const conflicts = actionResults.filter((r) => r.status === 'conflict');

      if (completed.length > 0) {
        await OfflineCacheService.invalidateSnapshot(userId);
      }

      SocketService.emitToUser(userId, 'offline:sync:complete', {
        syncedAt: new Date().toISOString(),
        actionsCompleted: completed.length,
        actionsFailed: failed.length,
        conflictsDetected: conflicts.length,
        domainsUpdated: 0,
        note: 'Call GET /api/v1/offline/delta for domain updates',
      });

      for (const conflict of conflicts) {
        SocketService.emitToUser(userId, 'offline:conflict', {
          clientKey: conflict.clientKey,
          conflictData: conflict.conflictData,
        });
      }
    } catch (err: any) {
      logger.error('OfflineSyncService: socket reconnect sync failed', {
        userId,
        error: err.message,
      });
    }
  },

  /**
   * Vector-clock-based batch sync (issue #689).
   * Validates each change's vector clock against the entity's current server-side
   * clock, detects concurrent (conflicting) writes from different devices, applies
   * non-conflicting changes, and returns conflicts for the client to resolve.
   */
  async syncChanges(
    userId: string,
    deviceId: string,
    changes: SyncChange[],
  ): Promise<SyncChangesResult> {
    const applied: SyncChangesResult['applied'] = [];
    const conflicts: SyncConflict[] = [];

    for (const change of changes) {
      const table = ENTITY_TABLE[change.entityType];

      const { rows } = await pool.query(
        `SELECT id, vector_clock, updated_at FROM ${table} WHERE id = $1`,
        [change.entityId],
      );
      const serverRow = rows[0];
      const serverClock: VectorClock = serverRow?.vector_clock ?? {};

      const comparison =
        change.operation === 'create' || !serverRow
          ? 'before'
          : compareVectorClocks(change.vectorClock, serverClock);

      if (comparison === 'concurrent') {
        conflicts.push({
          entityType: change.entityType,
          entityId: change.entityId,
          clientVersion: { vectorClock: change.vectorClock, payload: change.payload },
          serverVersion: { vectorClock: serverClock, payload: serverRow ?? {} },
          resolutionStrategy: RESOLUTION_STRATEGY[change.entityType],
        });
        continue;
      }

      const nextClock = incrementClock(mergeVectorClocks(change.vectorClock, serverClock), deviceId);

      await this.applyChange(change, table, nextClock, serverRow ?? null);

      await pool.query(
        `INSERT INTO sync_changes (user_id, entity_type, entity_id, operation, vector_clock, payload, device_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          userId,
          change.entityType,
          change.entityId,
          change.operation,
          JSON.stringify(nextClock),
          JSON.stringify(change.payload),
          deviceId,
        ],
      );

      applied.push({ entityType: change.entityType, entityId: change.entityId, vectorClock: nextClock });
    }

    const { rows: cursorRows } = await pool.query(
      `SELECT COALESCE(MAX(cursor), 0)::bigint AS cursor FROM sync_changes WHERE user_id = $1`,
      [userId],
    );

    return {
      cursor: Number(cursorRows[0]?.cursor ?? 0),
      applied,
      conflicts,
    };
  },

  /**
   * Applies a validated (non-conflicting) change to the underlying entity table,
   * per the entity's resolution strategy (server-wins/merge/last-write-wins only
   * matter when there IS a conflict; a clean apply is a straightforward write).
   */
  async applyChange(
    change: SyncChange,
    table: string,
    nextClock: VectorClock,
    existingRow: Record<string, unknown> | null,
  ): Promise<void> {
    if (change.operation === 'delete') {
      await pool.query(`DELETE FROM ${table} WHERE id = $1`, [change.entityId]);
      return;
    }

    if (change.operation === 'create') {
      const columns = Object.keys(change.payload);
      const values = Object.values(change.payload);
      const placeholders = columns.map((_, i) => `$${i + 1}`);
      await pool.query(
        `INSERT INTO ${table} (id, ${columns.join(', ')}, vector_clock)
         VALUES ($${columns.length + 1}, ${placeholders.join(', ')}, $${columns.length + 2})
         ON CONFLICT (id) DO NOTHING`,
        [...values, change.entityId, JSON.stringify(nextClock)],
      );
      return;
    }

    // update
    if (change.entityType === 'session_notes' && existingRow) {
      // Append-only merge: session notes never overwrite prior content
      const existingContent = String(existingRow.content ?? '');
      const incomingContent = String(change.payload.content ?? '');
      const merged = existingContent && !existingContent.includes(incomingContent)
        ? `${existingContent}\n${incomingContent}`
        : existingContent || incomingContent;

      await pool.query(
        `UPDATE ${table} SET content = $1, vector_clock = $2, updated_at = NOW() WHERE id = $3`,
        [merged, JSON.stringify(nextClock), change.entityId],
      );
      return;
    }

    const columns = Object.keys(change.payload);
    const sets = columns.map((col, i) => `${col} = $${i + 1}`);
    const values = Object.values(change.payload);
    await pool.query(
      `UPDATE ${table} SET ${sets.join(', ')}, vector_clock = $${columns.length + 1}, updated_at = NOW() WHERE id = $${columns.length + 2}`,
      [...values, JSON.stringify(nextClock), change.entityId],
    );
  },

  /**
   * Cursor-based incremental fetch of changes since a given server-side cursor.
   */
  async getChangesSince(
    userId: string,
    since: number,
  ): Promise<{ changes: Array<Record<string, unknown>>; cursor: number }> {
    const { rows } = await pool.query(
      `SELECT entity_type, entity_id, operation, vector_clock, payload, device_id, synced_at, cursor
       FROM sync_changes
       WHERE user_id = $1 AND cursor > $2
       ORDER BY cursor ASC
       LIMIT 500`,
      [userId, since],
    );

    const cursor = rows.length ? Number(rows[rows.length - 1].cursor) : since;

    return {
      changes: rows.map((r) => ({
        entityType: r.entity_type,
        entityId: r.entity_id,
        operation: r.operation,
        vectorClock: r.vector_clock,
        payload: r.payload,
        deviceId: r.device_id,
        syncedAt: r.synced_at,
      })),
      cursor,
    };
  },
};
