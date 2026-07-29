/**
 * OutboxService — high-level facade over `OutboxModel`.
 *
 * Use these helpers from service code at the moment a domain transition
 * happens. They write the outbox row in the same DB transaction as the
 * entity update (when a `client` is provided) or in a self-managed
 * transaction (when called standalone).
 *
 * Event-type conventions:
 *   booking.*  -> destination `notification-queue` (fan-out worker)
 *   payment.*  -> destination `notification-queue`
 *   dispute.*  -> destination `notification-queue`
 *   user.*     -> destination `notification-queue`
 *
 * @see docs/OUTBOX_PATTERN.md for the architecture.
 */

import pool from "../config/database";
import { DatabaseService } from "./database.service";
import {
  OutboxModel,
  OutboxEventInput,
  OutboxEventRecord,
} from "../models/outbox.model";
import { logger } from "../utils/logger.utils";
import type { PoolClient } from "pg";

// Re-use the destination constants so we have one place to change transport
// later (e.g. moving to Kafka, adding Socket.IO direct emit, etc.).
export const OUTBOX_DESTINATION = {
  NOTIFICATIONS: "notification-queue",
  WEBHOOK_DELIVERY: "webhook-delivery-queue",
  EMAIL: "email-queue",
} as const;

export type OutboxDestination =
  (typeof OUTBOX_DESTINATION)[keyof typeof OUTBOX_DESTINATION];

export interface OutboxEmitOptions {
  /** Pass a `PoolClient` from `DatabaseService.withTransaction` to commit
   *  the outbox row atomically with the domain update. */
  client?: PoolClient | null;
  correlationId?: string;
  userId?: string;
  /** Override the dedup key. Defaults to `${aggregateType}:${aggregateId}:${eventType}`. */
  idempotencyKey?: string;
}

/**
 * Emit a reliability-critical event to the outbox.
 *
 * Pass a `client` from inside `DatabaseService.withTransaction` so the
 * outbox row is committed atomically with your entity update. If omitted,
 * the helper opens its own transaction so callers can fire low-risk
 * outbox events without holding a transaction.
 *
 * After the in-transaction insert, this helper issues a non-blocking
 * `NOTIFY outbox_event` on the same client. This wakes the outbox worker
 * immediately (in addition to its 500 ms poll) for sub-50 ms latency.
 */
export async function emitOutboxEvent(
  input: OutboxEventInput,
  options: OutboxEmitOptions = {},
): Promise<OutboxEventRecord | null> {
  const write = async (exec: PoolClient) => {
    const record = await OutboxModel.writeInTransaction(exec, input);
    // Fire-and-forget NOTIFY — purely a wake-up signal for the worker.
    // Polling is the correctness guarantee; LISTEN/NOTIFY is just latency
    // optimisation. Errors here must not affect the insert.
    try {
      await exec.query("NOTIFY outbox_event");
    } catch (notifyErr) {
      logger.warn(
        { err: notifyErr, eventType: input.eventType },
        "[OutboxService] NOTIFY outbox_event failed (non-fatal)",
      );
    }
    return record;
  };

  if (options.client) {
    return write(options.client);
  }

  return DatabaseService.withTransaction(async (client) => {
    const result = await write(client);
    if (!result) {
      logger.debug(
        { eventType: input.eventType, idempotencyKey: options.idempotencyKey },
        "[OutboxService] Duplicate idempotency_key — skipping",
      );
    }
    return result;
  });
}

// ─── Domain-specific helpers ──────────────────────────────────────────────────

export interface BookingConfirmedPayload {
  bookingId: string;
  mentorId: string;
  menteeId: string;
  scheduledAt: string;
  durationMinutes: number;
  topic?: string;
  amount: string;
  currency: string;
  status: "confirmed";
}

export async function emitBookingConfirmed(
  payload: BookingConfirmedPayload,
  options: OutboxEmitOptions,
): Promise<OutboxEventRecord | null> {
  const fallbackUserId =
    payload.mentorId && payload.menteeId
      ? `${payload.mentorId},${payload.menteeId}`
      : undefined;
  return emitOutboxEvent(
    {
      aggregateType: "booking",
      aggregateId: payload.bookingId,
      eventType: "booking.confirmed",
      destination: OUTBOX_DESTINATION.NOTIFICATIONS,
      payload: payload as unknown as Record<string, unknown>,
      userId: options.userId ?? fallbackUserId,
      correlationId: options.correlationId,
      idempotencyKey:
        options.idempotencyKey ?? `booking:${payload.bookingId}:confirmed`,
    },
    options,
  );
}

export interface BookingCancelledPayload {
  bookingId: string;
  mentorId: string;
  menteeId: string;
  scheduledAt: string;
  reason?: string;
  refundIssued: boolean;
  status: "cancelled";
}

export async function emitBookingCancelled(
  payload: BookingCancelledPayload,
  options: OutboxEmitOptions,
): Promise<OutboxEventRecord | null> {
  const fallbackUserId =
    payload.mentorId && payload.menteeId
      ? `${payload.mentorId},${payload.menteeId}`
      : undefined;
  return emitOutboxEvent(
    {
      aggregateType: "booking",
      aggregateId: payload.bookingId,
      eventType: "booking.cancelled",
      destination: OUTBOX_DESTINATION.NOTIFICATIONS,
      payload: payload as unknown as Record<string, unknown>,
      userId: options.userId ?? fallbackUserId,
      correlationId: options.correlationId,
      idempotencyKey:
        options.idempotencyKey ?? `booking:${payload.bookingId}:cancelled`,
    },
    options,
  );
}

export interface PaymentConfirmedPayload {
  paymentId: string;
  bookingId: string | null;
  userId: string;
  amount: string;
  currency: string;
  stellarTxHash: string | null;
  completedAt: string;
}

export async function emitPaymentConfirmed(
  payload: PaymentConfirmedPayload,
  options: OutboxEmitOptions,
): Promise<OutboxEventRecord | null> {
  return emitOutboxEvent(
    {
      aggregateType: "payment",
      aggregateId: payload.paymentId,
      eventType: "payment.confirmed",
      destination: OUTBOX_DESTINATION.NOTIFICATIONS,
      payload: payload as unknown as Record<string, unknown>,
      userId: options.userId ?? payload.userId,
      correlationId: options.correlationId,
      idempotencyKey:
        options.idempotencyKey ?? `payment:${payload.paymentId}:confirmed`,
    },
    options,
  );
}

export interface DisputeOpenedPayload {
  disputeId: string;
  filedById: string;
  respondentId: string | null;
  bookingId: string;
  type: string;
  reason: string;
}

export async function emitDisputeOpened(
  payload: DisputeOpenedPayload,
  options: OutboxEmitOptions,
): Promise<OutboxEventRecord | null> {
  return emitOutboxEvent(
    {
      aggregateType: "dispute",
      aggregateId: payload.disputeId,
      eventType: "dispute.opened",
      destination: OUTBOX_DESTINATION.NOTIFICATIONS,
      payload: payload as unknown as Record<string, unknown>,
      userId: options.userId ?? payload.filedById,
      correlationId: options.correlationId,
      idempotencyKey:
        options.idempotencyKey ?? `dispute:${payload.disputeId}:opened`,
    },
    options,
  );
}

export interface DisputeResolvedPayload {
  disputeId: string;
  filedById: string;
  respondentId: string | null;
  bookingId: string;
  mentorPct: number;
  notes: string;
}

export async function emitDisputeResolved(
  payload: DisputeResolvedPayload,
  options: OutboxEmitOptions,
): Promise<OutboxEventRecord | null> {
  return emitOutboxEvent(
    {
      aggregateType: "dispute",
      aggregateId: payload.disputeId,
      eventType: "dispute.resolved",
      destination: OUTBOX_DESTINATION.NOTIFICATIONS,
      payload: payload as unknown as Record<string, unknown>,
      userId: options.userId ?? payload.filedById,
      correlationId: options.correlationId,
      idempotencyKey:
        options.idempotencyKey ?? `dispute:${payload.disputeId}:resolved`,
    },
    options,
  );
}

export interface NotificationFanoutPayload {
  userId: string;
  type: string;
  channels: Array<"in_app" | "push" | "email">;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  notificationId?: string;
}

export async function emitNotificationFanout(
  payload: NotificationFanoutPayload,
  options: OutboxEmitOptions,
): Promise<OutboxEventRecord | null> {
  return emitOutboxEvent(
    {
      aggregateType: "notification",
      aggregateId: payload.notificationId ?? `${payload.userId}:${Date.now()}`,
      eventType: "notification.fanout",
      destination: OUTBOX_DESTINATION.NOTIFICATIONS,
      payload: payload as unknown as Record<string, unknown>,
      userId: options.userId ?? payload.userId,
      correlationId: options.correlationId,
      idempotencyKey:
        options.idempotencyKey ??
        `notification:${payload.notificationId ?? payload.userId}:${payload.type}`,
    },
    options,
  );
}

export const OutboxService = {
  emit: emitOutboxEvent,
  emitBookingConfirmed,
  emitBookingCancelled,
  emitPaymentConfirmed,
  emitDisputeOpened,
  emitDisputeResolved,
  emitNotificationFanout,
  /** Read-only helper for the worker / admin endpoints. */
  depthByStatus: () => OutboxModel.depthByStatus(pool),
  listDeadLetter: (limit = 100) => OutboxModel.listDeadLetter(limit, pool),
  replayDeadLetter: (id: string) => OutboxModel.replayDeadLetter(id, pool),
  cleanupProcessed: (days = 7) => OutboxModel.cleanupProcessed(days, pool),
};

export default OutboxService;
