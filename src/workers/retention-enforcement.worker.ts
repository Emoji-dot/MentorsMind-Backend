import { CronJob } from "cron";
import { ComplianceService } from "../services/compliance.service";
import { logger } from "../utils/logger.utils";
import * as Sentry from "@sentry/node";

let retentionJob: CronJob;

export const startRetentionEnforcementWorker = () => {
  if (retentionJob) {
    logger.warn("Retention enforcement worker is already running");
    return;
  }

  // Run every Sunday at 03:00 UTC
  retentionJob = new CronJob("0 3 * * 0", async () => {
    logger.info("Starting scheduled retention enforcement");
    try {
      const result = await ComplianceService.enforceRetentionPolicies();
      logger.info("Retention enforcement completed", { result });
    } catch (error) {
      const err = error as Error;
      logger.error("Retention enforcement failed", { error: err.message, stack: err.stack });
      Sentry.captureException(err);
    }
  }, null, true, "UTC");

  retentionJob.start();
  logger.info("Retention enforcement worker started (runs every Sunday at 03:00 UTC)");
};

export const stopRetentionEnforcementWorker = () => {
  if (retentionJob) {
    retentionJob.stop();
    logger.info("Retention enforcement worker stopped");
  }
};
