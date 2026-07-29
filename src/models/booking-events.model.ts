import { v4 as uuidv4 } from 'uuid';

// ---------------------------------------------------------------------------
// Event type enum
// ---------------------------------------------------------------------------

export enum BookingEventType {
  BookingCreated = 'BookingCreated',
  BookingConfirmed = 'BookingConfirmed',
  BookingCompleted = 'BookingCompleted',
  BookingCancelled = 'BookingCancelled',
  BookingRescheduled = 'BookingRescheduled',
  BookingPaymentUpdated = 'BookingPaymentUpdated',
}

// ---------------------------------------------------------------------------
// Payload interfaces — one per event type
// ---------------------------------------------------------------------------

export interface BookingCreatedPayload {
  menteeId: string;
  mentorId: string;
  scheduledAt: Date;
  durationMinutes: number;
  topic: string;
  notes?: string;
  amount: string;
  currency: string;
}

export interface BookingConfirmedPayload {
  previousStatus: string;
  escrowContractAddress?: string;
  escrowId?: string;
}

export interface BookingCompletedPayload {
  previousStatus: string;
  sessionId?: string;
}

export interface BookingCancelledPayload {
  previousStatus: string;
  cancellationReason: string;
  refundEligible: boolean;
  refundPercentage: number;
}

export interface BookingRescheduledPayload {
  previousScheduledAt: Date;
  newScheduledAt: Date;
  reason?: string;
}

export interface BookingPaymentUpdatedPayload {
  previousPaymentStatus: string;
  newPaymentStatus: string;
  stellarTxHash?: string;
  transactionId?: string;
}

// ---------------------------------------------------------------------------
// Base domain event interface
// ---------------------------------------------------------------------------

/**
 * Generic base for all booking domain events.
 *
 * @template TPayload  - The event-specific payload shape.
 * @template TType     - The specific BookingEventType literal (narrows the
 *                       discriminant so switch/exhaustiveness checks work).
 */
export interface BookingDomainEvent<
  TPayload,
  TType extends BookingEventType = BookingEventType,
> {
  /** UUID v4 — uniquely identifies this event instance */
  id: string;
  /** The booking this event belongs to */
  aggregateId: string;
  /** Always 'Booking' for events in this model */
  aggregateType: 'Booking';
  /**
   * Monotonically increasing sequence number within the aggregate stream.
   * Set to 0 here; the event-store append logic should overwrite with the
   * actual position before persisting.
   */
  version: number;
  /** Wall-clock timestamp when the event was created */
  occurredAt: Date;
  /** ID of the user (or system actor) whose action triggered this event */
  causedBy: string;
  /** Distributed-tracing / request correlation identifier */
  correlationId: string;
  /** Discriminant — narrows the union without casting */
  eventType: TType;
  /** The event-specific data */
  payload: TPayload;
}

// ---------------------------------------------------------------------------
// Discriminated union of all concrete booking event types
// ---------------------------------------------------------------------------

export type BookingEvent =
  | BookingDomainEvent<BookingCreatedPayload, BookingEventType.BookingCreated>
  | BookingDomainEvent<BookingConfirmedPayload, BookingEventType.BookingConfirmed>
  | BookingDomainEvent<BookingCompletedPayload, BookingEventType.BookingCompleted>
  | BookingDomainEvent<BookingCancelledPayload, BookingEventType.BookingCancelled>
  | BookingDomainEvent<BookingRescheduledPayload, BookingEventType.BookingRescheduled>
  | BookingDomainEvent<BookingPaymentUpdatedPayload, BookingEventType.BookingPaymentUpdated>;

// ---------------------------------------------------------------------------
// Options shared by every factory method
// ---------------------------------------------------------------------------

export interface BookingEventOptions {
  /** The booking aggregate id this event belongs to */
  bookingId: string;
  /** ID of the user / system actor that caused the event */
  causedBy: string;
  /** Correlation id for distributed tracing */
  correlationId: string;
}

// ---------------------------------------------------------------------------
// Factory — builds typed domain events with sensible defaults
// ---------------------------------------------------------------------------

export class BookingEventFactory {
  /**
   * Private generic helper that fills in all base fields.
   * The caller supplies the concrete `eventType` literal so TypeScript
   * narrows `TType` to that specific member.
   */
  private static build<TPayload, TType extends BookingEventType>(
    eventType: TType,
    opts: BookingEventOptions,
    payload: TPayload,
  ): BookingDomainEvent<TPayload, TType> {
    return {
      id: uuidv4(),
      aggregateId: opts.bookingId,
      aggregateType: 'Booking',
      version: 0, // Filled in by the event-store append logic
      occurredAt: new Date(),
      causedBy: opts.causedBy,
      correlationId: opts.correlationId,
      eventType,
      payload,
    };
  }

  static created(
    opts: BookingEventOptions,
    payload: BookingCreatedPayload,
  ): BookingDomainEvent<BookingCreatedPayload, BookingEventType.BookingCreated> {
    return BookingEventFactory.build(BookingEventType.BookingCreated, opts, payload);
  }

  static confirmed(
    opts: BookingEventOptions,
    payload: BookingConfirmedPayload,
  ): BookingDomainEvent<BookingConfirmedPayload, BookingEventType.BookingConfirmed> {
    return BookingEventFactory.build(BookingEventType.BookingConfirmed, opts, payload);
  }

  static completed(
    opts: BookingEventOptions,
    payload: BookingCompletedPayload,
  ): BookingDomainEvent<BookingCompletedPayload, BookingEventType.BookingCompleted> {
    return BookingEventFactory.build(BookingEventType.BookingCompleted, opts, payload);
  }

  static cancelled(
    opts: BookingEventOptions,
    payload: BookingCancelledPayload,
  ): BookingDomainEvent<BookingCancelledPayload, BookingEventType.BookingCancelled> {
    return BookingEventFactory.build(BookingEventType.BookingCancelled, opts, payload);
  }

  static rescheduled(
    opts: BookingEventOptions,
    payload: BookingRescheduledPayload,
  ): BookingDomainEvent<BookingRescheduledPayload, BookingEventType.BookingRescheduled> {
    return BookingEventFactory.build(BookingEventType.BookingRescheduled, opts, payload);
  }

  static paymentUpdated(
    opts: BookingEventOptions,
    payload: BookingPaymentUpdatedPayload,
  ): BookingDomainEvent<BookingPaymentUpdatedPayload, BookingEventType.BookingPaymentUpdated> {
    return BookingEventFactory.build(BookingEventType.BookingPaymentUpdated, opts, payload);
  }
}
