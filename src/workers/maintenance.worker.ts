import { Worker, Job } from "bullmq";
import { redisConnection, QUEUE_NAMES, CONCURRENCY } from "../config/queue";
import { runMaintenanceTasks } from "./scheduler";
import { VerificationService } from "../services/verification.service";
import { AuditLogArchivalJob } from "../jobs/auditLog.job";
import keyRotationJob from "../jobs/keyRotation.job";
import { logger } from "../utils/logger.utils";

async function processMaintenanceJob(job: Job): Promise<void> {
  if (job.name === "verification-retry-scheduled") {
    logger.info("[MaintenanceWorker] Running on-chain verification retry", {
      jobId: job.id,
    });
    await VerificationService.retryPendingOnChainVerifications();
    return;
  }

  if (job.name === "audit-log-archival-scheduled") {
    logger.info("[MaintenanceWorker] Running audit log archival", {
      jobId: job.id,
    });
    await AuditLogArchivalJob.run();
    return;
  }

  if (job.name === "key-rotation-scheduled") {
    logger.info("[MaintenanceWorker] Running key rotation", {
      jobId: job.id,
    });
    await keyRotationJob.runJwtRotation();
    return;
  }

  logger.info("[MaintenanceWorker] Running maintenance tasks", { jobId: job.id });
  await runMaintenanceTasks();
}

export const maintenanceWorker = new Worker(
  QUEUE_NAMES.MAINTENANCE,
  processMaintenanceJob,
  { connection: redisConnection, concurrency: CONCURRENCY.MAINTENANCE },
);

maintenanceWorker.on("completed", (job) => {
  logger.info("[MaintenanceWorker] Job completed", { jobId: job.id });
});

maintenanceWorker.on("failed", (job, err) => {
  logger.error("[MaintenanceWorker] Job failed", {
    jobId: job?.id,
    attempt: job?.attemptsMade,
    error: err.message,
  });
});

maintenanceWorker.on("error", (err) => {
  logger.error("[MaintenanceWorker] Worker error", { error: err.message });
});
