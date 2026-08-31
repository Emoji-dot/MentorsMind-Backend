/**
 * OutboxModel — database layer for the Transactional Outbox Pattern.
 *
 * Service code MUST call `writeInTransaction(client, event)` inside the same
 * `DatabaseService.withTransaction` callback that performs the domain update.
 * That way the row is committed atomically with the entity update — a server
 * crash between commit and BullMQ enqueue is no longer possible, because the
 * outbox worker's polling loop will re-dispatch the event.
 *
 * The outbox worker claims rows with `SELECT ... FOR UPDATE SKIP LOCKED` so any
 * number of workers can run in parallel without double-processing.
 *
 * @see docs/OUTBOX_PATTERN.md for the full architecture.
 */

import pool from "../config/database";
import { logger } from "../utils/logger.utils";
import type { PoolClient } from "pg";

// ─── Status / Configuration ───────────────────────────────────────────────────

export type OutboxStatus =
  | "pending"
  | "processing"
  | "processed"
  | "failed"
  | "dead_letter";

/** Default lease length a worker holds on a claimed row. */
export const OUTBOX_DEFAULT_LEASE_SECONDS = 30;

/** Per-event retry threshold before moving to dead_letter. */
export const OUTBOX_MAX_ATTEMPTS = 5;

/** Retention window for processed events (debugging + audit). */
export const OUTBOX_RETENTION_DAYS = 7;

/** Default poll batch size for the outbox worker. */
export const OUTBOX_POLL_BATCH_SIZE = 50;

// ─── Event record shape ───────────────────────────────────────────────────────

export interface OutboxEventRecord {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  destination: string;
  payload: Record<string, unknown>;
  headers: Record<string, unknown>;
  idempotency_key: string;
  status: OutboxStatus;
  attempts: number;
  last_error: string | null;
  locked_until: Date | null;
  created_at: Date;
  next_retry_at: Date;
  processed_at: Date | null;
  correlation_id: string | null;
  user_id: string | null;
}

export interface OutboxEventInput {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  destination: string;
  payload: Record<string, unknown>;
  headers?: Record<string, unknown>;
  /** Optional override. Defaults to `${aggregateType}:${aggregateId}:${eventType}` */
  idempotencyKey?: string;
  correlationId?: string;
  userId?: string;
  /** Optional override to schedule the event for the future. */
  nextRetryAt?: Date;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildIdempotencyKey(input: OutboxEventInput): string {
  return (
    input.idempotencyKey ??
    `${input.aggregateType}:${input.aggregateId}:${input.eventType}`
  );
}

// ─── OutboxModel ──────────────────────────────────────────────────────────────

export const OutboxModel = {
  /**
   * Insert a new outbox row using the provided transaction client.
   *
   * MUST be called inside `DatabaseService.withTransaction` so the write is
   * atomic with the domain entity update. A duplicate `idempotency_key` is
   * intentionally swallowed (returns `null`) — retries from upstream callers
   * should be safe and idempotent.
   *
   * @returns the inserted record on success, `null` if the idempotency_key
   *          already existed (i.e. duplicate dispatch).
   */
  async writeInTransaction(
    client: PoolClient,
    input: OutboxEventInput,
  ): Promise<OutboxEventRecord | null> {
    const idempotencyKey = buildIdempotencyKey(input);

    const query = `
      INSERT INTO outbox_events (
        aggregate_type, aggregate_id, event_type, destination,
        payload, headers, idempotency_key, status,
        next_retry_at, correlation_id, user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending',
              COALESCE($8, NOW()), $9, $10)
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING *;
    `;

    const values = [
      input.aggregateType,
      input.aggregateId,
      input.eventType,
      input.destination,
      JSON.stringify(input.payload ?? {}),
      JSON.stringify(input.headers ?? {}),
      idempotencyKey,
      input.nextRetryAt ?? null,
      input.correlationId ?? null,
      input.userId ?? null,
    ];

    try {
      const { rows } = await client.query<OutboxEventRecord>(query, values);
      if (!rows[0]) {
        logger.debug("[OutboxModel] Duplicate idempotency_key — skipped", {
          idempotencyKey,
          eventType: input.eventType,
          aggregateType: input.aggregateType,
          aggregateId: input.aggregateId,
        });
        return null;
      }
      return rows[0];
    } catch (error) {
      logger.error(
        { err: error, idempotencyKey, aggregateType: input.aggregateType },
        "[OutboxModel] writeInTransaction failed",
      );
      throw error;
    }
  },

  /**
   * Atomically claim and lock up to `limit` events ready for dispatch using
   * `SELECT ... FOR UPDATE SKIP LOCKED`. Rows are flipped to `processing` and
   * given a `locked_until` lease so crashed workers do not strand events.
   *
   * The lock is held for the duration of the caller's transaction.
   */
  async claimBatch(
    limit: number,
    leaseSeconds: number = OUTBOX_DEFAULT_LEASE_SECONDS,
    executer: PoolClient | typeof pool = pool,
  ): Promise<OutboxEventRecord[]> {
    // Eligible rows: pending or failed rows whose backoff has elapsed,
    // OR processing rows whose lease has expired (crashed-worker recovery).
    const claimQuery = `
      WITH eligible AS (
        SELECT id
        FROM outbox_events
        WHERE (
              (status = 'pending' AND next_retry_at <= NOW())
           OR (status = 'failed'  AND next_retry_at <= NOW())
           OR (status = 'processing' AND locked_until IS NOT NULL AND locked_until <= NOW())
        )
        ORDER BY next_retry_at ASC, created_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE outbox_events o
      SET status = 'processing',
          locked_until = NOW() + ($2 || ' seconds')::interval,
          attempts = o.attempts + 1
      FROM eligible
      WHERE o.id = eligible.id
      RETURNING o.*;
    `;

    try {
      const { rows } = await executer.query<OutboxEventRecord>(claimQuery, [
        limit,
        leaseSeconds.toString(),
      ]);
      return rows;
    } catch (error) {
      logger.error(
        { err: error, limit, leaseSeconds },
        "[OutboxModel] claimBatch failed",
      );
      throw error;
    }
  },

  /**
   * Mark a batch of events as successfully processed. Called inside the same
   * transaction that confirmed the BullMQ enqueue so the two are atomic.
   */
  async markProcessed(
    ids: string[],
    executer: PoolClient | typeof pool = pool,
  ): Promise<number> {
    if (ids.length === 0) return 0;
    const query = `
      UPDATE outbox_events
      SET status = 'processed',
          processed_at = NOW(),
          locked_until = NULL
      WHERE id = ANY($1::uuid[]);
    `;
    const { rowCount } = await executer.query(query, [ids]);
    return rowCount ?? 0;
  },

  /**
   * Mark a single event as failed and schedule its next retry using an
   * exponential backoff. If `attempts` has already met `OUTBOX_MAX_ATTEMPTS`
   * the row is flipped to `dead_letter` immediately.
   */
  async markFailed(
    id: string,
    errorMessage: string,
    currentAttempts: number,
    executer: PoolClient | typeof pool = pool,
  ): Promise<{ nextStatus: OutboxStatus; nextRetryAt: Date }> {
    const isFinal = currentAttempts >= OUTBOX_MAX_ATTEMPTS;
    const status: OutboxStatus = isFinal ? "dead_letter" : "failed";
    // Exponential backoff: 2^attempts seconds, capped at 15 minutes
    const delaySeconds = Math.min(15 * 60, Math.pow(2, currentAttempts));
    const nextRetryAt = new Date(Date.now() + delaySeconds * 1000);

    const query = `
      UPDATE outbox_events
      SET status = $2,
          last_error = $3,
          next_retry_at = $4,
          locked_until = NULL
      WHERE id = $1;
    `;
    await executer.query(query, [id, status, errorMessage.slice(0, 4096), nextRetryAt]);

    if (isFinal) {
      logger.error(
        { outboxId: id, attempts: currentAttempts, lastError: errorMessage },
        "[OutboxModel] Event moved to dead_letter (max retries exceeded)",
      );
    } else {
      logger.warn(
        { outboxId: id, attempts: currentAttempts, nextRetryAt },
        "[OutboxModel] Event dispatch failed — scheduled for retry",
      );
    }

    return { nextStatus: status, nextRetryAt };
  },

  /**
   * Manually move a dead-letter event back to `pending`. Used by the replay
   * script in `scripts/outbox-replay.ts`.
   */
  async replayDeadLetter(
    id: string,
    executer: PoolClient | typeof pool = pool,
  ): Promise<boolean> {
    const { rowCount } = await executer.query(
      `UPDATE outbox_events
       SET status = 'pending',
           attempts = 0,
           last_error = NULL,
           next_retry_at = NOW(),
           locked_until = NULL
       WHERE id = $1 AND status = 'dead_letter'`,
      [id],
    );
    return (rowCount ?? 0) > 0;
  },

  /**
   * List dead-letter events for inspection / monitoring dashboards.
   * `limit` is bounded to 200 to keep the response cheap.
   */
  async listDeadLetter(
    limit = 100,
    executer: PoolClient | typeof pool = pool,
  ): Promise<OutboxEventRecord[]> {
    const bounded = Math.max(1, Math.min(200, limit));
    const { rows } = await executer.query<OutboxEventRecord>(
      `SELECT * FROM outbox_events
       WHERE status = 'dead_letter'
       ORDER BY created_at DESC
       LIMIT $1`,
      [bounded],
    );
    return rows;
  },

  /**
   * Return queueing depth by status. Useful for metrics + the worker health
   * probe.
   */
  async depthByStatus(
    executer: PoolClient | typeof pool = pool,
  ): Promise<Record<OutboxStatus, number>> {
    const { rows } = await executer.query<{ status: OutboxStatus; n: string }>(
      `SELECT status, COUNT(*) AS n FROM outbox_events GROUP BY status`,
    );
    const out: Record<OutboxStatus, number> = {
      pending: 0,
      processing: 0,
      processed: 0,
      failed: 0,
      dead_letter: 0,
    };
    for (const row of rows) {
      out[row.status] = parseInt(row.n, 10);
    }
    return out;
  },

  /**
   * Delete processed events older than the retention window. Called from the
   * daily maintenance job to satisfy the "7 days for debugging" requirement.
   */
  async cleanupProcessed(
    retentionDays: number = OUTBOX_RETENTION_DAYS,
    executer: PoolClient | typeof pool = pool,
  ): Promise<number> {
    const { rowCount } = await executer.query(
      `DELETE FROM outbox_events
       WHERE status = 'processed'
         AND processed_at IS NOT NULL
         AND processed_at < NOW() - ($1 || ' days')::interval`,
      [retentionDays.toString()],
    );
    return rowCount ?? 0;
  },
};

export default OutboxModel;
