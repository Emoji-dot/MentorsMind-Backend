import { Worker, Job } from "bullmq";
import { redisConnection, QUEUE_NAMES, CONCURRENCY } from "../config/queue";
import { SessionQualityService } from "../services/session-quality.service";
import { QualityScoreJobData } from "../queues/quality-score.queue";
import { emailService } from "../services/email.service";
import { mentorQualityScoreGauge } from "../config/metrics";
import pool from "../config/database";
import { logger } from "../utils/logger.utils";

const AT_RISK_THRESHOLD = 60; // score < 60 => "at_risk" tier
const SUSPENSION_THRESHOLD = 50; // score < 50 for 3 consecutive days => suspension flag
const SUSPENSION_CONSECUTIVE_DAYS = 3;

async function handleTierAlert(
  mentorId: string,
  mentorEmail: string,
  mentorName: string,
  score: number,
  tier: string,
): Promise<void> {
  const { rows } = await pool.query(
    `SELECT consecutive_at_risk_days, last_tier, last_warning_sent_at, suspension_flagged_at
     FROM mentor_quality_alerts WHERE mentor_id = $1`,
    [mentorId],
  );
  const alertState = rows[0] ?? {
    consecutive_at_risk_days: 0,
    last_tier: null,
    last_warning_sent_at: null,
    suspension_flagged_at: null,
  };

  const isAtRisk = score < AT_RISK_THRESHOLD;
  const isBelowSuspensionThreshold = score < SUSPENSION_THRESHOLD;

  const consecutiveAtRiskDays = isBelowSuspensionThreshold
    ? Number(alertState.consecutive_at_risk_days) + 1
    : 0;

  // "At Risk" tier transition (from a non-at-risk tier) → warning email + reduced search visibility
  const justEnteredAtRisk = isAtRisk && alertState.last_tier !== "at_risk";
  if (justEnteredAtRisk) {
    await pool.query(
      `UPDATE users SET search_visibility_reduced = true WHERE id = $1`,
      [mentorId],
    );

    try {
      await emailService.sendEmail({
        to: [mentorEmail],
        subject: "Your MentorsMind quality score needs attention",
        htmlContent: `<p>Hi ${mentorName},</p><p>Your mentor quality score has dropped to ${score} (At Risk tier). This affects your search visibility. Please review your completion rate, ratings, response times, and cancellations, and reach out to support if you have questions.</p>`,
        textContent: `Hi ${mentorName}, your mentor quality score has dropped to ${score} (At Risk tier). This affects your search visibility.`,
        priority: "high",
      });
    } catch (err: any) {
      logger.error("[QualityScoreWorker] Failed to send at-risk warning email", {
        mentorId,
        error: err.message,
      });
    }

    logger.warn("[QualityScoreWorker] Mentor entered At Risk tier", {
      mentorId,
      score,
    });
  }

  // Three consecutive days below 50 → suspension flag + admin review ticket (idempotent)
  const shouldFlagSuspension =
    consecutiveAtRiskDays >= SUSPENSION_CONSECUTIVE_DAYS &&
    !alertState.suspension_flagged_at;

  if (shouldFlagSuspension) {
    await pool.query(
      `UPDATE users SET suspension_flagged = true WHERE id = $1`,
      [mentorId],
    );

    await pool.query(
      `INSERT INTO admin_review_tasks (task_type, subject_id, reason, metadata)
       VALUES ($1, $2, $3, $4)`,
      [
        "mentor_suspension_review",
        mentorId,
        `Mentor quality score below ${SUSPENSION_THRESHOLD} for ${consecutiveAtRiskDays} consecutive days`,
        JSON.stringify({ score, consecutiveAtRiskDays }),
      ],
    );

    logger.warn("[QualityScoreWorker] Mentor flagged for suspension review", {
      mentorId,
      score,
      consecutiveAtRiskDays,
    });
  }

  await pool.query(
    `INSERT INTO mentor_quality_alerts (mentor_id, consecutive_at_risk_days, last_tier, last_warning_sent_at, suspension_flagged_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (mentor_id) DO UPDATE SET
       consecutive_at_risk_days = EXCLUDED.consecutive_at_risk_days,
       last_tier = EXCLUDED.last_tier,
       last_warning_sent_at = COALESCE(EXCLUDED.last_warning_sent_at, mentor_quality_alerts.last_warning_sent_at),
       suspension_flagged_at = COALESCE(mentor_quality_alerts.suspension_flagged_at, EXCLUDED.suspension_flagged_at),
       updated_at = NOW()`,
    [
      mentorId,
      consecutiveAtRiskDays,
      tier,
      justEnteredAtRisk ? new Date() : alertState.last_warning_sent_at,
      shouldFlagSuspension ? new Date() : null,
    ],
  );
}

async function processQualityScoreJob(_job: Job<QualityScoreJobData>): Promise<void> {
  const mentorIds = await SessionQualityService.getActiveMentorIds();

  logger.info("[QualityScoreWorker] Computing quality scores", {
    mentorCount: mentorIds.length,
  });

  let succeeded = 0;
  let failed = 0;

  for (const mentorId of mentorIds) {
    try {
      const result = await SessionQualityService.computeMentorQualityScore(mentorId);
      await SessionQualityService.persistMentorQualityScore(result);

      mentorQualityScoreGauge.set({ mentorId }, result.score);

      const { rows } = await pool.query(
        `SELECT email, first_name FROM users WHERE id = $1`,
        [mentorId],
      );
      if (rows[0]) {
        await handleTierAlert(
          mentorId,
          rows[0].email,
          rows[0].first_name,
          result.score,
          result.tier,
        );
      }

      succeeded++;
    } catch (err: any) {
      failed++;
      logger.error("[QualityScoreWorker] Failed to compute score for mentor", {
        mentorId,
        error: err.message,
      });
    }
  }

  logger.info("[QualityScoreWorker] Quality score run complete", {
    total: mentorIds.length,
    succeeded,
    failed,
  });
}

export const qualityScoreWorker = new Worker(
  QUEUE_NAMES.QUALITY_SCORE,
  processQualityScoreJob,
  { connection: redisConnection, concurrency: CONCURRENCY.QUALITY_SCORE },
);

qualityScoreWorker.on("completed", (job) => {
  logger.info("[QualityScoreWorker] Job completed", { jobId: job.id });
});

qualityScoreWorker.on("failed", (job, err) => {
  logger.error("[QualityScoreWorker] Job failed", {
    jobId: job?.id,
    attempt: job?.attemptsMade,
    error: err.message,
  });
});

qualityScoreWorker.on("error", (err) => {
  logger.error("[QualityScoreWorker] Worker error", { error: err.message });
});
