/**
 * QueueService — unified facade for enqueueing background jobs.
 *
 * Callers import one service instead of individual queue files, keeping
 * controller/service code decoupled from BullMQ internals.
 */
import { enqueueEmail } from "../queues/email.queue";
import { enqueueStellarTx } from "../queues/stellar-tx.queue";
import {
  scheduleEscrowRelease,
  cancelEscrowRelease,
} from "../queues/escrow-release.queue";
import { enqueueNotification } from "../queues/notification.queue";
import { enqueuePaymentPoll } from "../queues/payment-poll.queue";
import { enqueueDomainEvent } from "../queues/domain-events.queue";
import type { EmailRequest } from "../services/email.service";
import type { StellarTxJobData } from "../queues/stellar-tx.queue";
import type { EscrowReleaseJobData } from "../queues/escrow-release.queue";
import type { NotificationJobData } from "../queues/notification.queue";
import type { PaymentPollJobData } from "../queues/payment-poll.queue";
import type { DomainEventJobData } from "../queues/domain-events.queue";import type { JobConfig } from '../queues/queue.manager';
export const QueueService = {
  /**
   * Enqueue an outbound email.
   * @param data - Email request payload (to, subject, body/html/template)
   * @param priority - Optional BullMQ job priority (lower = higher priority)
   */
  async sendEmail(data: EmailRequest, priority?: number): Promise<void> {
    await enqueueEmail(data, priority);
  },

  /**
   * Submit a signed Stellar transaction XDR and poll until confirmed.
   * @param data - Transaction payload including the raw XDR envelope
   * @param jobId - Optional deduplication key (defaults to paymentId or timestamp)
   */
  async submitStellarTx(
    data: StellarTxJobData,
    jobId?: string,
    options?: Partial<JobConfig>,
  ): Promise<void> {
    await enqueueStellarTx(data, jobId, options);
  },

  /**
   * Schedule an escrow auto-release 48 hours after session completion.
   * Uses jobId deduplication — safe to call multiple times for the same escrow.
   */
  async scheduleEscrowRelease(data: EscrowReleaseJobData): Promise<void> {
    await scheduleEscrowRelease(data);
  },

  /**
   * Cancel a pending escrow auto-release (e.g. when a dispute is raised).
   */
  async cancelEscrowRelease(escrowId: string): Promise<void> {
    await cancelEscrowRelease(escrowId);
  },

  /**
   * Fan-out a notification to WebSocket and/or push channels.
   */
  async sendNotification(
    data: NotificationJobData,
    options?: Partial<JobConfig>,
  ): Promise<void> {
    await enqueueNotification(data, options);
  },

  /**
   * Poll a Stellar payment until confirmed or the attempt limit is reached.
   */
  async pollPayment(
    data: PaymentPollJobData,
    options?: Partial<JobConfig>,
  ): Promise<void> {
    await enqueuePaymentPoll(data, options);
  },

  /**
   * Persist a domain event in the outbox queue for asynchronous fan-out via
   * EventBus.publish().  The domain-events worker picks up the job and
   * publishes it to the Redis pub/sub channel so all in-process subscribers
   * are notified.
   *
   * @param data    - Domain event payload (aggregateId, eventType, data, …).
   * @param options - Optional BullMQ job overrides (priority, attempts, …).
   */
  async enqueueDomainEvent(
    data: DomainEventJobData,
    options?: Partial<JobConfig>,
  ): Promise<void> {
    await enqueueDomainEvent(data, options);
  },
};

export default QueueService;
