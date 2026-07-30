/**
 * Insight Generation Worker
 *
 * Background pipeline for personalized analytics insights.
 *
 * Job types:
 *  - insight-generation-dispatch: run generateInsights() (admin + fan-out per user)
 *  - insight-generation-admin:     platform admin insights only
 *  - insight-generation-user:      personalized insights for one user
 *
 * Target SLA: 1,000 active users within 10 minutes (concurrency 20).
 */

import { Worker, Job } from "bullmq";
import { redisConnection, CONCURRENCY } from "../config/queue";
import {
  InsightGenerationJobData,
  INSIGHT_GENERATION_QUEUE,
} from "../queues/insightGeneration.queue";
import { InsightGeneratorService } from "../services/insight-generator.service";
import { logger } from "../utils/logger.utils";

async function processInsightGenerationJob(
  job: Job<InsightGenerationJobData>,
): Promise<Record<string, unknown>> {
  const { jobType, userId, role } = job.data;
  const startedAt = Date.now();

  if (
    jobType === "insight-generation-dispatch" ||
    job.name === "insight-generation-scheduled"
  ) {
    logger.info("[InsightGenerationWorker] Dispatching insight pipeline", {
      jobId: job.id,
    });
    const result = await InsightGeneratorService.generateInsights();
    return { ...result, durationMs: Date.now() - startedAt };
  }

  if (jobType === "insight-generation-admin") {
    logger.info("[InsightGenerationWorker] Generating admin insights", {
      jobId: job.id,
    });
    const insights = await InsightGeneratorService.generateAdminInsights();
    await InsightGeneratorService.storeInsights(insights);
    return { count: insights.length, durationMs: Date.now() - startedAt };
  }

  if (jobType === "insight-generation-user") {
    if (!userId || !role) {
      throw new Error("insight-generation-user requires userId and role");
    }

    const insights = await InsightGeneratorService.generateInsightsForUser(
      userId,
      role,
    );

    return {
      userId,
      role,
      count: insights.length,
      durationMs: Date.now() - startedAt,
    };
  }

  logger.warn("[InsightGenerationWorker] Unknown job type", {
    jobId: job.id,
    jobType,
    name: job.name,
  });
  return { skipped: true };
}

export const insightGenerationWorker = new Worker<InsightGenerationJobData>(
  INSIGHT_GENERATION_QUEUE,
  processInsightGenerationJob,
  {
    connection: redisConnection,
    concurrency: CONCURRENCY.INSIGHT_GENERATION,
  },
);

insightGenerationWorker.on("completed", (job) => {
  logger.debug("[InsightGenerationWorker] Job completed", {
    jobId: job.id,
    jobType: job.data.jobType,
  });
});

insightGenerationWorker.on("failed", (job, err) => {
  logger.error("[InsightGenerationWorker] Job failed", {
    jobId: job?.id,
    jobType: job?.data?.jobType,
    attempt: job?.attemptsMade,
    error: err.message,
  });
});

insightGenerationWorker.on("error", (err) => {
  logger.error("[InsightGenerationWorker] Worker error", { error: err.message });
});
