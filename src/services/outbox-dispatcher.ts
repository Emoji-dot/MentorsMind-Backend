/**
 * Outbox dispatcher — translates a claimed outbox event into one or more
 * BullMQ jobs so the existing downstream workers (notifications, webhook
 * delivery, email) can process them.
 *
 * This is the bridge between the durable outbox_events row (one row per
 * domain transition) and the ephemeral BullMQ queues (one fan-out job per
 * recipient / target).
 *
 * Idempotency: each resulting job carries `idempotencyKey` in its data so
 * downstream workers can dedupe with their own UNIQUE constraint.
 */

import type { OutboxEventRecord } from "../models/outbox.model";
import type { NotificationJobData } from "../queues/notification.queue";

/** Per outbox event we may produce 0+ downstream jobs. */
export interface DispatchedJob {
  destination: string;
  /** Job name (used by BullMQ for routing + observability). */
  name: string;
  /** Job data — shape depends on destination. */
  data: Record<string, unknown>;
  /** Optional pre-computed job id so retries reuse the same BullMQ slot. */
  jobId?: string;
}

// ─── Notification job builders ────────────────────────────────────────────────

function bookingConfirmedTitle(): string {
  return "Booking Confirmed";
}
function bookingConfirmedMessage(
  scheduledAt: string,
  durationMinutes: number,
  topic?: string,
): string {
  const when = new Date(scheduledAt).toLocaleString();
  return `Your session is confirmed for ${when} (${durationMinutes} min).${topic ? ` Topic: ${topic}` : ""}`;
}

function bookingCancelledTitle(): string {
  return "Booking Cancelled";
}
function bookingCancelledMessage(reason?: string): string {
  return `Your session has been cancelled.${reason ? ` Reason: ${reason}` : ""}`;
}

function paymentConfirmedTitle(): string {
  return "Payment Processed";
}
function paymentConfirmedMessage(amount: string, currency: string): string {
  return `Your payment of ${amount} ${currency} has been processed successfully.`;
}

function disputeOpenedTitle(): string {
  return "Dispute Opened";
}
function disputeOpenedMessage(): string {
  return `A dispute has been opened. Our team will be in touch shortly.`;
}

function disputeResolvedTitle(): string {
  return "Dispute Resolved";
}
function disputeResolvedMessage(mentorPct: number): string {
  return `Your dispute has been resolved (mentor share: ${mentorPct}%).`;
}

const NOTIFICATION_JOB_NAME = "outbox:fan-out-notification";

function notificationJobsForRecipients(
  recipients: Array<string | null | undefined>,
  base: Omit<NotificationJobData, "userId">,
  event: OutboxEventRecord,
): DispatchedJob[] {
  const jobs: DispatchedJob[] = [];
  for (const userId of recipients) {
    if (!userId) continue;
    jobs.push({
      destination: "notification-queue",
      name: NOTIFICATION_JOB_NAME,
      jobId: `outbox-${event.id}-notify-${userId}`,
      data: {
        ...base,
        userId,
        // Loop-back to outbox row id so downstream workers can dedupe.
        outboxId: event.id,
        idempotencyKey: event.idempotency_key,
        correlationId: event.correlation_id ?? event.id,
      } as unknown as Record<string, unknown>,
    });
  }
  return jobs;
}

// ─── Event-type routers ───────────────────────────────────────────────────────

function dispatchBookingConfirmed(event: OutboxEventRecord): DispatchedJob[] {
  const p = event.payload as {
    bookingId: string;
    mentorId: string;
    menteeId: string;
    scheduledAt: string;
    durationMinutes: number;
    topic?: string;
  };
  return notificationJobsForRecipients(
    [p.mentorId, p.menteeId],
    {
      type: "booking_confirmed",
      channels: ["websocket", "push", "email"],
      title: bookingConfirmedTitle(),
      message: bookingConfirmedMessage(
        p.scheduledAt,
        p.durationMinutes,
        p.topic,
      ),
      data: {
        bookingId: p.bookingId,
        scheduledAt: p.scheduledAt,
        durationMinutes: p.durationMinutes,
        event: "booking_confirmed",
      },
    },
    event,
  );
}

function dispatchBookingCancelled(event: OutboxEventRecord): DispatchedJob[] {
  const p = event.payload as {
    bookingId: string;
    mentorId: string;
    menteeId: string;
    reason?: string;
  };
  return notificationJobsForRecipients(
    [p.mentorId, p.menteeId],
    {
      type: "session_cancelled",
      channels: ["websocket", "push", "email"],
      title: bookingCancelledTitle(),
      message: bookingCancelledMessage(p.reason),
      data: { bookingId: p.bookingId, event: "booking_cancelled" },
    },
    event,
  );
}

function dispatchPaymentConfirmed(event: OutboxEventRecord): DispatchedJob[] {
  const p = event.payload as {
    paymentId: string;
    userId: string;
    amount: string;
    currency: string;
    bookingId?: string | null;
  };
  return notificationJobsForRecipients(
    [p.userId],
    {
      type: "payment_processed",
      channels: ["websocket", "push", "email"],
      title: paymentConfirmedTitle(),
      message: paymentConfirmedMessage(p.amount, p.currency),
      data: { paymentId: p.paymentId, bookingId: p.bookingId, event: "payment_confirmed" },
    },
    event,
  );
}

function dispatchDisputeOpened(event: OutboxEventRecord): DispatchedJob[] {
  const p = event.payload as {
    disputeId: string;
    filedById: string;
    respondentId?: string | null;
  };
  return notificationJobsForRecipients(
    [p.filedById, p.respondentId],
    {
      type: "dispute_created",
      channels: ["websocket", "email"],
      title: disputeOpenedTitle(),
      message: disputeOpenedMessage(),
      data: { disputeId: p.disputeId, event: "dispute_opened" },
    },
    event,
  );
}

function dispatchDisputeResolved(event: OutboxEventRecord): DispatchedJob[] {
  const p = event.payload as {
    disputeId: string;
    filedById: string;
    respondentId?: string | null;
    mentorPct: number;
  };
  return notificationJobsForRecipients(
    [p.filedById, p.respondentId],
    {
      type: "system_alert",
      channels: ["websocket", "email"],
      title: disputeResolvedTitle(),
      message: disputeResolvedMessage(p.mentorPct),
      data: { disputeId: p.disputeId, event: "dispute_resolved", mentorPct: p.mentorPct },
    },
    event,
  );
}

const ROUTERS: Record<string, (e: OutboxEventRecord) => DispatchedJob[]> = {
  "booking.confirmed": dispatchBookingConfirmed,
  "booking.cancelled": dispatchBookingCancelled,
  "payment.confirmed": dispatchPaymentConfirmed,
  "dispute.opened": dispatchDisputeOpened,
  "dispute.resolved": dispatchDisputeResolved,
};

/**
 * Translate a single outbox event into 0+ downstream jobs.
 * Returns [] if the event has no notification fan-out (e.g. a synthetic
 * routing event that was already handled elsewhere).
 */
export function translateOutboxToJobs(
  event: OutboxEventRecord,
): DispatchedJob[] {
  const router = ROUTERS[event.event_type];
  if (!router) {
    return [];
  }
  return router(event);
}

/**
 * Helper: same as translateOutboxToJobs, but groups by destination so the
 * worker can call addBulk once per queue.
 */
export function groupJobsByDestination(
  jobs: DispatchedJob[],
): Map<string, DispatchedJob[]> {
  const out = new Map<string, DispatchedJob[]>();
  for (const job of jobs) {
    if (!out.has(job.destination)) out.set(job.destination, []);
    out.get(job.destination)!.push(job);
  }
  return out;
}
