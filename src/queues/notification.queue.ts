import { createManagedQueue, buildJobOptions, JobConfig } from './queue.manager';
import { JOB_RATE_LIMITS, QUEUE_NAMES } from './queue.config';

/** Notification delivery channels. `websocket` is the real-time in-app channel. */
export type NotificationChannelName = 'websocket' | 'push' | 'email';

/** Per-channel delivery state, persisted on the job so retries only touch failed channels. */
export type ChannelDeliveryStatus = 'sent' | 'failed' | 'dead_letter';

/**
 * Maximum delivery attempts per channel before the channel is moved to the
 * dead-letter queue and stops being retried (issue #782). Retry limits are
 * independent per channel so a channel that has exhausted its budget never
 * blocks — or re-triggers — delivery on the others.
 */
export const CHANNEL_RETRY_LIMITS: Record<NotificationChannelName, number> = {
  email: 3,
  push: 5,
  websocket: 2,
};

export interface NotificationJobData {
  /** Target user ID. */
  userId: string;
  /** Notification type (maps to NotificationType enum values). */
  type: string;
  /** Channels to fan-out: 'websocket' | 'push' | 'email'. */
  channels: NotificationChannelName[];
  title: string;
  message: string;
  /** Optional stored notification record ID for delivery tracking. */
  notificationId?: string;
  /** Arbitrary payload forwarded to WebSocket/push clients. */
  data?: Record<string, unknown>;
  /**
   * Per-channel delivery status from previous attempts. On retry, only
   * channels that are neither 'sent' nor 'dead_letter' are re-attempted.
   */
  channelStatus?: Partial<Record<NotificationChannelName, ChannelDeliveryStatus>>;
  /** Number of delivery attempts made so far, per channel. */
  channelAttempts?: Partial<Record<NotificationChannelName, number>>;
}

/** BullMQ queue for notification fan-out (WebSocket + push). */
export const notificationQueue = createManagedQueue<NotificationJobData>(
  QUEUE_NAMES.NOTIFICATIONS,
  {
    limiter: JOB_RATE_LIMITS.NOTIFICATIONS,
  },
);

/** Enqueue a notification fan-out job. */
export async function enqueueNotification(
  data: NotificationJobData,
  options?: Partial<JobConfig>,
): Promise<void> {
  await notificationQueue.add(
    options?.name ?? 'fan-out-notification',
    data,
    buildJobOptions(options),
  );
}
