/**
 * Booking aggregate reducer — pure fold of domain events → booking state.
 *
 * Used by:
 * - Snapshot creation (EventStoreService.createSnapshot)
 * - Event replay / rebuild
 * - Projection handlers that need derived state
 */

import { DomainEvent } from "../models/event.model";

export const BOOKING_AGGREGATE_TYPE = "Booking";

export enum BookingProjectionEventType {
  BookingCreated = "BookingCreated",
  BookingStatusChanged = "BookingStatusChanged",
  BookingCancelled = "BookingCancelled",
  // Compatibility with existing BookingEventType enum / legacy streams
  BookingConfirmed = "BookingConfirmed",
  BookingCompleted = "BookingCompleted",
}

export interface BookingAggregateState {
  id?: string;
  mentee_id?: string;
  mentor_id?: string;
  scheduled_at?: Date | string;
  duration_minutes?: number;
  topic?: string;
  notes?: string | null;
  amount?: string;
  currency?: string;
  status?: string;
  payment_status?: string;
  cancellation_reason?: string | null;
  stellar_tx_hash?: string | null;
  transaction_id?: string | null;
  version?: number;
  updated_at?: Date | string;
  [key: string]: unknown;
}

/** Normalize pg snake_case rows and camelCase DomainEvent into one shape. */
export function normalizeBookingEvent(event: DomainEvent | Record<string, any>): DomainEvent {
  const raw = event as Record<string, any>;
  const metadataRaw = typeof raw.metadata === "string" ? JSON.parse(raw.metadata) : raw.metadata || {};
  const dataRaw = typeof raw.data === "string" ? JSON.parse(raw.data) : raw.data || {};

  return {
    id: raw.id,
    aggregateId: raw.aggregateId ?? raw.aggregate_id,
    aggregateType: raw.aggregateType ?? raw.aggregate_type,
    eventType: raw.eventType ?? raw.event_type,
    version: raw.version,
    data: dataRaw,
    metadata: {
      userId: metadataRaw.userId ?? metadataRaw.user_id ?? "",
      timestamp: metadataRaw.timestamp
        ? new Date(metadataRaw.timestamp)
        : new Date(),
      correlationId:
        metadataRaw.correlationId ?? metadataRaw.correlation_id ?? "",
    },
  };
}

/**
 * Pure function: apply one booking domain event to aggregate state.
 * Snapshots at version 10/20/30 use this so stored state is complete, not `{}`.
 */
export function applyBookingEvent(
  state: BookingAggregateState,
  event: DomainEvent | Record<string, any>,
): BookingAggregateState {
  const e = normalizeBookingEvent(event);
  const data = e.data || {};
  const updatedAt = e.metadata?.timestamp ?? new Date();

  switch (e.eventType) {
    case BookingProjectionEventType.BookingCreated:
      return {
        ...state,
        id: e.aggregateId,
        mentee_id: data.menteeId ?? data.mentee_id,
        mentor_id: data.mentorId ?? data.mentor_id,
        scheduled_at: data.scheduledAt ?? data.scheduled_at,
        duration_minutes: data.durationMinutes ?? data.duration_minutes,
        topic: data.topic,
        notes: data.notes ?? null,
        amount: data.amount,
        currency: data.currency ?? "XLM",
        status: data.status ?? "pending",
        payment_status: data.paymentStatus ?? data.payment_status ?? "pending",
        cancellation_reason: null,
        version: e.version,
        updated_at: updatedAt,
      };

    case BookingProjectionEventType.BookingStatusChanged:
      return {
        ...state,
        status: data.status ?? data.newStatus ?? state.status,
        payment_status:
          data.paymentStatus ??
          data.payment_status ??
          data.newPaymentStatus ??
          state.payment_status,
        version: e.version,
        updated_at: updatedAt,
      };

    case BookingProjectionEventType.BookingConfirmed:
      return {
        ...state,
        status: "confirmed",
        payment_status: data.paymentStatus ?? state.payment_status,
        version: e.version,
        updated_at: updatedAt,
      };

    case BookingProjectionEventType.BookingCompleted:
      return {
        ...state,
        status: "completed",
        version: e.version,
        updated_at: updatedAt,
      };

    case BookingProjectionEventType.BookingCancelled:
      return {
        ...state,
        status: "cancelled",
        cancellation_reason:
          data.cancellationReason ??
          data.cancellation_reason ??
          state.cancellation_reason ??
          null,
        payment_status:
          data.paymentStatus ?? data.payment_status ?? state.payment_status,
        version: e.version,
        updated_at: updatedAt,
      };

    default:
      return {
        ...state,
        version: e.version,
        updated_at: updatedAt,
      };
  }
}
