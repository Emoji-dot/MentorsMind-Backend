export type OfflineChangeAction = "create" | "update" | "delete";

export interface OfflineChange {
  id: string;
  entity: string;
  action: OfflineChangeAction;
  payload: Record<string, unknown>;
  clientVersion?: number;
  timestamp?: string;
}

export interface OfflineSyncDelta {
  lastSyncedAt?: string;
  pendingChanges: OfflineChange[];
  conflicts?: Array<{
    entityId: string;
    conflictType: string;
    serverVersion?: number;
    clientVersion?: number;
  }>;
}

export interface OfflineSyncPayload {
  userId: string;
  deviceId: string;
  timestamp: string;
  delta: OfflineSyncDelta;
}

export interface ConflictResolutionResult {
  status: "client-wins" | "server-wins" | "merged";
  resolvedPayload?: Record<string, unknown>;
  clientVersion?: number;
  serverVersion?: number;
  message?: string;
}

export class OfflineSyncService {
  static createSyncPayload(
    userId: string,
    deviceId: string,
    delta: Partial<OfflineSyncDelta> = {},
  ): OfflineSyncPayload {
    return {
      userId,
      deviceId,
      timestamp: new Date().toISOString(),
      delta: {
        lastSyncedAt: delta.lastSyncedAt,
        pendingChanges: delta.pendingChanges ?? [],
        conflicts: delta.conflicts ?? [],
      },
    };
  }

  static resolveConflict(
    clientRecord: Record<string, unknown> | null,
    serverRecord: Record<string, unknown> | null,
  ): ConflictResolutionResult {
    if (!clientRecord && !serverRecord) {
      return {
        status: "merged",
        message: "No client or server record exists.",
      };
    }

    if (!clientRecord) {
      return {
        status: "server-wins",
        resolvedPayload: serverRecord ?? {},
        serverVersion: Number((serverRecord as any)?.version ?? 0),
        message: "Server record retained because client record was missing.",
      };
    }

    if (!serverRecord) {
      return {
        status: "client-wins",
        resolvedPayload: clientRecord,
        clientVersion: Number((clientRecord as any)?.version ?? 0),
        message: "Client record retained because server record was missing.",
      };
    }

    const clientVersion = Number((clientRecord as any)?.version ?? 0);
    const serverVersion = Number((serverRecord as any)?.version ?? 0);

    if (clientVersion >= serverVersion) {
      return {
        status: "client-wins",
        resolvedPayload: clientRecord,
        clientVersion,
        serverVersion,
        message: "Client version is current or newer.",
      };
    }

    return {
      status: "server-wins",
      resolvedPayload: serverRecord,
      clientVersion,
      serverVersion,
      message: "Server version is newer than the client version.",
    };
  }

  static applyPendingChanges<T>(
    baseState: T,
    pendingChanges: OfflineChange[] = [],
  ): T {
    const merged = { ...(baseState as Record<string, unknown>) };

    for (const change of pendingChanges) {
      if (change.action === "delete") {
        delete (merged as Record<string, unknown>)[change.entity];
        continue;
      }

      if (change.action === "create" || change.action === "update") {
        (merged as Record<string, unknown>)[change.entity] = {
          ...(typeof (merged as Record<string, unknown>)[change.entity] ===
          "object"
            ? ((merged as Record<string, unknown>)[change.entity] as Record<
                string,
                unknown
              >)
            : {}),
          ...(change.payload ?? {}),
        };
      }
    }

    return merged as T;
  }
}

export default OfflineSyncService;
