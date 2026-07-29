import { Worker, Job } from "bullmq";
import {
  redisConnection,
  CONCURRENCY,
  QUEUE_NAMES,
} from "../queues/queue.config";
import { SocketService } from '../services/socket.service';
import { PushService } from '../services/push.service';
import { emailService } from '../services/email.service';
import { logger } from "../utils/logger.utils";
import pool from "../config/database";
import { notificationDeliveryAttemptsTotal } from "../config/metrics";
import type {
  ChannelDeliveryStatus,
  NotificationChannelName,
  NotificationJobData,
} from "../queues/notification.queue";
import { CHANNEL_RETRY_LIMITS } from "../queues/notification.queue";

const ADMIN_ALERT_CHANNELS: ReadonlySet<NotificationChannelName> = new Set([
  "email",
  "push",
]);

/** Attempts delivery on a single channel. Never throws — failures are reported via the return value. */
async function deliverChannel(
  channel: NotificationChannelName,
  job: Job<NotificationJobData>,
): Promise<{ success: boolean; error?: string }> {
  const { userId, type, title, message, notificationId, data } = job.data;

  try {
    switch (channel) {
      case "websocket": {
        SocketService.emitToUser(userId, type, { title, message, ...data });
        return { success: true };
      }

      case "push": {
        const result = await PushService.sendToUser(userId, title, message, {
          type,
          notificationId: notificationId ?? "",
          ...(data as Record<string, string> | undefined),
        });
        if (!result.success) {
          return { success: false, error: result.errors.join(", ") || "push delivery failed" };
        }
        return { success: true };
      }

      case "email": {
        const { rows } = await pool.query<{ email: string }>(
          "SELECT email FROM users WHERE id = $1",
          [userId],
        );
        const email = rows[0]?.email;
        if (!email) {
          return { success: false, error: "user has no email on file" };
        }

        const result = await emailService.sendEmail({
          to: [email],
          subject: title,
          textContent: message,
          htmlContent: `<p>${message}</p>`,
          trackingId: notificationId,
        });
        if (!result.success) {
          return { success: false, error: result.error ?? "email delivery failed" };
        }
        return { success: true };
      }

      default:
        return { success: false, error: `unknown channel: ${channel}` };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Records one delivery attempt outcome for the notification_delivery_status materialized view. */
async function logChannelAttempt(
  job: Job<NotificationJobData>,
  channel: NotificationChannelName,
  status: ChannelDeliveryStatus,
  attemptNumber: number,
  errorMessage?: string,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO notification_channel_delivery_log
         (notification_id, job_id, user_id, channel, status, attempt_number, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        job.data.notificationId ?? null,
        String(job.id ?? ""),
        job.data.userId,
        channel,
        status,
        attemptNumber,
        errorMessage?.substring(0, 1024) ?? null,
      ],
    );
  } catch (error) {
    logger.error("Failed to log notification channel delivery attempt", {
      jobId: job.id,
      channel,
      error: error instanceof Error ? error.message : error,
    });
  }
}

/** Persists a channel exhausting its retry budget for admin visibility and reprocessing. */
async function moveChannelToDeadLetter(
  job: Job<NotificationJobData>,
  channel: NotificationChannelName,
  attemptCount: number,
  failureReason: string,
): Promise<void> {
  const { userId, type, title, message, notificationId, data } = job.data;

  try {
    await pool.query(
      `INSERT INTO notification_dead_letter_queue
         (notification_id, job_id, user_id, channel, type, title, message, payload, failure_reason, attempt_count, last_attempt_at, admin_alerted)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP, $11)`,
      [
        notificationId ?? null,
        String(job.id ?? ""),
        userId,
        channel,
        type,
        title,
        message,
        JSON.stringify(data ?? {}),
        failureReason.substring(0, 1024),
        attemptCount,
        ADMIN_ALERT_CHANNELS.has(channel),
      ],
    );
  } catch (error) {
    logger.error("Failed to persist notification dead-letter entry", {
      jobId: job.id,
      channel,
      error: error instanceof Error ? error.message : error,
    });
  }

  if (ADMIN_ALERT_CHANNELS.has(channel)) {
    logger.error("ADMIN ALERT: notification channel exhausted retries", {
      jobId: job.id,
      userId,
      channel,
      attemptCount,
      failureReason,
    });
  }
}

async function processNotification(
  job: Job<NotificationJobData>,
): Promise<void> {
  const { userId, type, channels, notificationId } = job.data;
  const channelStatus = { ...(job.data.channelStatus ?? {}) };
  const channelAttempts = { ...(job.data.channelAttempts ?? {}) };

  logger.info("Notification job started", {
    jobId: job.id,
    userId,
    type,
    channels,
    notificationId,
    attempt: job.attemptsMade + 1,
    channelStatus,
  });

  // Only channels that have not already succeeded or been dead-lettered are
  // attempted — this is what stops a PUSH failure from re-sending an EMAIL
  // that already delivered successfully on a prior attempt (issue #782).
  const pendingChannels = channels.filter(
    (channel) => channelStatus[channel] !== "sent" && channelStatus[channel] !== "dead_letter",
  );

  const errors: string[] = [];

  await Promise.allSettled(
    pendingChannels.map(async (channel) => {
      const outcome = await deliverChannel(channel, job);
      const attemptNumber = (channelAttempts[channel] ?? 0) + 1;
      channelAttempts[channel] = attemptNumber;

      if (outcome.success) {
        channelStatus[channel] = "sent" as ChannelDeliveryStatus;
        notificationDeliveryAttemptsTotal.labels(channel, "sent").inc();
        await logChannelAttempt(job, channel, "sent", attemptNumber);
        return;
      }

      const limit = CHANNEL_RETRY_LIMITS[channel];
      if (attemptNumber >= limit) {
        channelStatus[channel] = "dead_letter" as ChannelDeliveryStatus;
        notificationDeliveryAttemptsTotal.labels(channel, "dead_letter").inc();
        await logChannelAttempt(job, channel, "dead_letter", attemptNumber, outcome.error);
        await moveChannelToDeadLetter(job, channel, attemptNumber, outcome.error ?? "unknown error");
      } else {
        channelStatus[channel] = "failed" as ChannelDeliveryStatus;
        notificationDeliveryAttemptsTotal.labels(channel, "failed").inc();
        await logChannelAttempt(job, channel, "failed", attemptNumber, outcome.error);
      }

      errors.push(`${channel}: ${outcome.error ?? "unknown error"}`);
    }),
  );

  // Persist per-channel state on the job so a BullMQ retry sees which
  // channels still need attempting instead of re-running all of them.
  await job.updateData({ ...job.data, channelStatus, channelAttempts });

  const stillFailing = channels.some((channel) => channelStatus[channel] === "failed");

  if (errors.length > 0) {
    logger.warn("Notification job: per-channel delivery outcome", {
      jobId: job.id,
      userId,
      errors,
      channelStatus,
    });
  }

  logger.info("Notification job completed", {
    jobId: job.id,
    userId,
    channels,
    channelStatus,
  });

  // Throwing triggers BullMQ's backoff retry — but only channels still
  // marked 'failed' will be re-attempted next time (channel isolation).
  if (stillFailing) {
    throw new Error(`Channels pending retry: ${errors.join("; ")}`);
  }
}

export const notificationsWorker = new Worker<NotificationJobData>(
  QUEUE_NAMES.NOTIFICATIONS,
  processNotification,
  {
    connection: redisConnection,
    concurrency: CONCURRENCY.NOTIFICATIONS,
  },
);

notificationsWorker.on("completed", (job) => {
  logger.info("Notification job completed", {
    jobId: job.id,
    userId: job.data.userId,
  });
});

notificationsWorker.on("failed", (job, err) => {
  logger.error("Notification job failed", {
    jobId: job?.id,
    userId: job?.data?.userId,
    attempt: job?.attemptsMade,
    error: err.message,
  });
});

notificationsWorker.on("error", (err) => {
  logger.error("Notifications worker error", { error: err.message });
});
