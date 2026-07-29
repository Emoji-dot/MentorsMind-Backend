import { reportQueue } from "../queues/report.queue";
import { sessionReminderQueue } from "../queues/sessionReminder.queue";
import { escrowCheckQueue } from "../queues/escrow-check.queue";
import { notificationCleanupQueue } from "../queues/notificationCleanup.queue";
import { maintenanceQueue } from "../queues/maintenance.queue";
import { recordingCleanupQueue } from "../queues/recordingCleanup.queue";
import { analyticsRefreshQueue } from "../queues/analyticsRefresh.queue";
import { qualityScoreQueue } from "../queues/quality-score.queue";
import { VerificationService } from "../services/verification.service";
import { BackgroundCheckService } from "../services/background-check.service";
import { EnrollmentService } from "../services/enrollment.service";
import { accountDeletionJob } from "../jobs/accountDeletion.job";
import { logger } from "../utils/logger.utils";
import config from "../config";
import { AuditLogModel } from "../models/audit-log.model";
import { PaymentModel } from "../models/payment.model";
import SessionModel from "../models/session.model";
import { Queue, JobsOptions } from "bullmq";

let backgroundCheckPollingTimer: NodeJS.Timeout | null = null;

/**
 * Add a repeatable job only if it doesn't already exist.
 * Prevents duplicate repeatable jobs on server restarts.
 */
async function addRepeatableJobIfNotExists(
  queue: Queue,
  jobName: string,
  data: any,
  options: JobsOptions,
): Promise<void> {
  const existingJobs = await queue.getRepeatableJobs();
  const jobId = options.jobId;
  
  // Check if job already exists by jobId
  const exists = existingJobs.find(job => job.id === jobId);
  
  if (!exists) {
    await queue.add(jobName, data, options);
    logger.info(`Added repeatable job: ${jobName} (${jobId})`);
  } else {
    logger.info(`Repeatable job already exists: ${jobName} (${jobId})`);
  }
}

/**
 * Log the count of repeatable jobs for each queue
 */
async function logRepeatableJobCounts(): Promise<void> {
  const queues = [
    { name: "report", queue: reportQueue },
    { name: "sessionReminder", queue: sessionReminderQueue },
    { name: "escrowCheck", queue: escrowCheckQueue },
    { name: "notificationCleanup", queue: notificationCleanupQueue },
  ];

  for (const { name, queue } of queues) {
    const repeatableJobs = await queue.getRepeatableJobs();
    logger.info(`Queue ${name}: ${repeatableJobs.length} repeatable jobs`);
  }
}

/**
 * Register repeatable jobs.
 * BullMQ v5+ handles delayed/repeatable jobs natively — no QueueScheduler needed.
 * Call once at server startup.
 */
export async function startScheduler(): Promise<void> {
  // Analytics refresh — every 15 minutes
  // Each run enqueues one BullMQ job per materialized view; the worker holds a
  // per-view distributed lock so concurrent Railway instances never race.
  await addRepeatableJobIfNotExists(
    analyticsRefreshQueue,
    "analytics-refresh-scheduled",
    { jobType: "analytics-refresh" }, // no viewName → job enqueues individual view jobs
    {
      repeat: { pattern: "*/15 * * * *" },
      jobId: "analytics-refresh-recurring",
    },
  );

  // Weekly earnings report — every Monday at 08:00 UTC
  await addRepeatableJobIfNotExists(
    reportQueue,
    "weekly-earnings-scheduled",
    {
      reportType: "weekly-earnings",
      periodStart: "", // worker computes dynamically from current date
      periodEnd: "",
    },
    {
      repeat: { pattern: "0 8 * * 1" }, // cron: Monday 08:00 UTC
      jobId: "weekly-earnings-recurring",
    },
  );

  // Session reminders — every 5 minutes
  await addRepeatableJobIfNotExists(
    sessionReminderQueue,
    "session-reminder-scheduled",
    { jobType: "session-reminder" },
    {
      repeat: { pattern: "*/5 * * * *" },
      jobId: "session-reminder-recurring",
    },
  );

  // Hourly escrow eligibility check — releases escrows past the 48h window
  await addRepeatableJobIfNotExists(
    escrowCheckQueue,
    "escrow-check-scheduled",
    { jobType: "escrow-check-cron", triggeredAt: new Date().toISOString() },
    {
      repeat: { pattern: "0 * * * *" }, // cron: every hour on the hour
      jobId: "escrow-check-recurring",
    },
  );

  // Notification cleanup — daily at 02:00 UTC (delete expired notifications)
  await addRepeatableJobIfNotExists(
    notificationCleanupQueue,
    "notification-cleanup-scheduled",
    { jobType: "notification-cleanup" },
    {
      repeat: { pattern: "0 2 * * *" },
      jobId: "notification-cleanup-recurring",
    },
  );

  // Recording cleanup — weekly on Saturdays at 02:00 UTC
  // Identifies and soft-deletes orphaned S3 objects; aborts incomplete multipart uploads
  await addRepeatableJobIfNotExists(
    recordingCleanupQueue,
    "recording-cleanup-scheduled",
    { jobType: "recording-cleanup" },
    {
      repeat: { pattern: "0 2 * * 6" }, // Saturday 02:00 UTC
      jobId: "recording-cleanup-recurring",
    },
  );

  // Daily maintenance job — 04:00 UTC
  await maintenanceQueue.add(
    "daily-maintenance",
    {},
    {
      repeat: { pattern: "0 4 * * *" },
      jobId: "daily-maintenance-recurring",
    },
  );

  // On-chain verification retry — every 2 hours (issue #768). Retries mentor
  // verifications left in `on_chain_pending = true` when SOROBAN_RPC_URL was
  // unreachable at approval time.
  await addRepeatableJobIfNotExists(
    maintenanceQueue,
    "verification-retry-scheduled",
    { jobType: "verification-retry" },
    {
      repeat: { pattern: "0 */2 * * *" }, // cron: every 2 hours
      jobId: "verification-retry-recurring",
    },
  );

  // Audit log archival — daily at 01:00 UTC (issue #772). Moves audit_logs
  // rows older than AUDIT_ARCHIVE_AFTER_DAYS to a compressed, Object-Locked
  // S3 archive.
  await addRepeatableJobIfNotExists(
    maintenanceQueue,
    "audit-log-archival-scheduled",
    { jobType: "audit-log-archival" },
    {
      repeat: { pattern: "0 1 * * *" }, // cron: daily 01:00 UTC
      jobId: "audit-log-archival-recurring",
    },
  );

  // JWT Key Rotation — monthly on the 1st at 00:00 UTC (issue #778)
  await addRepeatableJobIfNotExists(
    maintenanceQueue,
    "key-rotation-scheduled",
    { jobType: "key-rotation" },
    {
      repeat: { pattern: "0 0 1 * *" }, // cron: 1st of every month at midnight
      jobId: "key-rotation-recurring",
    },
  );

  logger.info(
    "Job scheduler started — weekly earnings, session reminders, escrow check, notification cleanup, daily maintenance, verification retry, audit log archival, and key rotation registered",
  );

  if (!backgroundCheckPollingTimer) {
    backgroundCheckPollingTimer = setInterval(() => {
      BackgroundCheckService.pollPendingChecks().catch((error) => {
        logger.error("Background check polling failed", { error });
      });
    }, 6 * 60 * 60 * 1000);
    backgroundCheckPollingTimer.unref?.();
  }
}

export async function stopScheduler(): Promise<void> {
  if (backgroundCheckPollingTimer) {
    clearInterval(backgroundCheckPollingTimer);
    backgroundCheckPollingTimer = null;
  }
  logger.info("Job scheduler stopped");
}

/**
 * Run periodic maintenance tasks (called externally or via a daily cron).
 */
export async function runMaintenanceTasks(): Promise<void> {
  const expired = await VerificationService.flagExpiredVerifications();
  if (expired > 0) {
    logger.info("Maintenance: expired verifications flagged", {
      count: expired,
    });
  }

  const expiredTrials = await EnrollmentService.expireTrials();
  if (expiredTrials > 0) {
    logger.info("Maintenance: expired learning path trials paused", {
      count: expiredTrials,
    });
  }

  try {
    const deletions = await accountDeletionJob.run();
    if (deletions.processed > 0) {
      logger.info("Maintenance: processed account deletions", {
        total: deletions.processed,
        successful: deletions.successful,
        failed: deletions.failed,
      });
    }
  } catch (error) {
    logger.error("Maintenance: error processing account deletions", { error });
  }

  // Clean up old offline queue entries (completed/failed older than 7 days)
  try {
    const { OfflineQueueService } = await import("../services/offline-queue.service");
    const cleaned = await OfflineQueueService.cleanup(7);
    if (cleaned > 0) {
      logger.info("Maintenance: offline queue entries cleaned up", {
        count: cleaned,
      });
    }
  } catch (error) {
    logger.error("Maintenance: error cleaning up offline queue", { error });
  }

  // GDPR retention: delete data exports (S3 + DB) older than 30 days
  try {
    const { ExportService } = await import("../services/export.service");
    const cleaned = await ExportService.cleanupExpiredExports(30);
    if (cleaned > 0) {
      logger.info("Maintenance: expired data exports cleaned up", {
        count: cleaned,
      });
    }
  } catch (error) {
    logger.error("Maintenance: error cleaning up expired exports", { error });
  }
}
