import { Worker, Job } from "bullmq";
import { Asset } from "@stellar/stellar-sdk";
import {
  redisConnection,
  CONCURRENCY,
  QUEUE_NAMES,
} from "../queues/queue.config";
import { stellarService } from "../services/stellar.service";
import { logger } from "../utils/logger.utils";
import { AuditLoggerService } from "../services/audit-logger.service";
import { LogLevel, AuditAction } from "../utils/log-formatter.utils";
import pool from "../config/database";
import { PaymentsService } from "../services/payments.service";
import { VerificationService } from "../services/verification.service";
import type { StellarTxJobData } from "../queues/stellar-tx.queue";

/**
 * Handles `type: 'verification'` jobs — a reliable, independently-retried
 * delivery path for on-chain mentor verification submissions that failed
 * during the direct retry sweep (see VerificationService.retryPendingOnChainVerifications,
 * issue #768). Submission itself is idempotent, so re-running this after a
 * partial failure is safe.
 */
async function processVerificationTx(job: Job<StellarTxJobData>): Promise<void> {
  const { userId: mentorId, metadata } = job.data;
  const verificationId = metadata?.verificationId as string | undefined;

  logger.info("Verification on-chain retry job started", {
    jobId: job.id,
    mentorId,
    verificationId,
    attempt: job.attemptsMade + 1,
  });

  const txHash = await VerificationService.triggerOnChainVerification(mentorId);
  if (!txHash) {
    throw new Error(
      `On-chain verification retry produced no tx hash for mentor ${mentorId}`,
    );
  }

  if (verificationId) {
    await pool.query(
      `UPDATE mentor_verifications
       SET on_chain_tx_hash = $1, on_chain_pending = FALSE, retry_count = 0,
           last_retry_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [txHash, verificationId],
    );
  }

  logger.info("Verification on-chain retry job succeeded", {
    jobId: job.id,
    mentorId,
    verificationId,
    txHash,
  });
}

async function processStellarTx(job: Job<StellarTxJobData>): Promise<void> {
  const {
    txEnvelopeXdr,
    userId,
    paymentId,
    type,
    amount,
    currency,
    description,
  } = job.data;

  if (type === "verification") {
    return processVerificationTx(job);
  }

  logger.info("Stellar TX job started", {
    jobId: job.id,
    userId,
    paymentId,
    type,
    attempt: job.attemptsMade + 1,
  });

  let xdr = txEnvelopeXdr;
  if (!xdr && type === "refund" && paymentId && amount && currency) {
    // Build refund XDR
    const payment = await pool.query(
      "SELECT from_address FROM transactions WHERE id = $1",
      [paymentId],
    );
    if (!payment.rows[0]?.from_address) {
      throw new Error("No from_address found for refund");
    }
    const toPublicKey = payment.rows[0].from_address;
    xdr = await stellarService.buildRefundTransaction(
      toPublicKey,
      amount,
      currency === "XLM" ? undefined : new Asset(currency, "GA..."),
    ); // Need to handle assets
    // For now, assume XLM
  }

  if (!xdr) {
    throw new Error("No transaction XDR to submit");
  }

  const result = await stellarService.submitTransaction(xdr);

  if (!result.successful) {
    // Submission reached Stellar but the tx was rejected — do not retry
    logger.error("Stellar transaction rejected", {
      jobId: job.id,
      hash: result.hash,
      resultXdr: result.resultXdr,
    });

    if (paymentId) {
      await pool.query(
        "UPDATE transactions SET status = 'failed', updated_at = NOW() WHERE id = $1",
        [paymentId],
      );
    }

    // Mark job as permanently failed by throwing a non-retryable error
    const err = new Error(`Stellar transaction rejected: ${result.resultXdr}`);
    (err as any).retryable = false;
    throw err;
  }

  logger.info("Stellar transaction confirmed", {
    jobId: job.id,
    hash: result.hash,
    ledger: result.ledger,
    paymentId,
  });

  if (paymentId) {
    if (type === "refund") {
      // For refunds, call refundPayment to create the refund record and update booking
      await PaymentsService.refundPayment(
        paymentId,
        userId,
        amount,
        description,
        result.hash,
      );
    } else {
      // For regular payments, update the payment record
      await pool.query(
        "UPDATE transactions SET status = 'completed', stellar_tx_hash = $1, completed_at = NOW(), updated_at = NOW() WHERE id = $2",
        [result.hash, paymentId],
      );
    }
  }

  await AuditLoggerService.logEvent({
    level: LogLevel.INFO,
    action: AuditAction.PAYMENT_PROCESSED,
    message: `Stellar transaction confirmed: ${result.hash}`,
    userId,
    entityType: "payment",
    entityId: paymentId ?? result.hash,
    metadata: { hash: result.hash, ledger: result.ledger },
  });
}

export const stellarTxWorker = new Worker<StellarTxJobData>(
  QUEUE_NAMES.STELLAR_TX,
  processStellarTx,
  {
    connection: redisConnection,
    concurrency: CONCURRENCY.STELLAR_TX,
  },
);

stellarTxWorker.on("completed", (job) => {
  logger.info("Stellar TX job completed", {
    jobId: job.id,
    paymentId: job.data.paymentId,
  });
});

stellarTxWorker.on("failed", (job, err) => {
  const isExhausted = (job?.attemptsMade ?? 0) >= (job?.opts?.attempts ?? 40);
  const level = isExhausted ? "error" : "warn";

  logger[level]("Stellar TX job failed", {
    jobId: job?.id,
    paymentId: job?.data?.paymentId,
    attempt: job?.attemptsMade,
    maxAttempts: job?.opts?.attempts,
    error: err.message,
  });

  if (isExhausted && job?.data?.paymentId) {
    AuditLoggerService.logEvent({
      level: LogLevel.ERROR,
      action: AuditAction.PAYMENT_PROCESSED,
      message: `Stellar TX unconfirmed after max attempts for payment ${job.data.paymentId}`,
      userId: job.data.userId,
      entityType: "payment",
      entityId: job.data.paymentId,
      metadata: { error: err.message },
    }).catch(() => {});
  }
});

stellarTxWorker.on("error", (err) => {
  logger.error("Stellar TX worker error", { error: err.message });
});
