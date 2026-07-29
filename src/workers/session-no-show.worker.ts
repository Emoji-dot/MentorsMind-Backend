import { Worker, Job } from 'bullmq';
import {
  redisConnection,
  CONCURRENCY,
  QUEUE_NAMES,
} from '../config/queue';
import { pool } from '../config/database';
import { PresenceService } from '../services/presence.service';
import { SorobanEscrowService } from '../services/sorobanEscrow.service';
import { NotificationService } from '../services/notification.service';
import { logger } from '../utils/logger.utils';
import { AuditLoggerService } from '../services/audit-logger.service';
import { LogLevel, AuditAction } from '../utils/log-formatter.utils';
import { redisClient } from '../config/redis';
import type { SessionNoShowJobData } from '../queues/session-no-show.queue';

const SYSTEM_USER_ID = 'system';
const presenceService = new PresenceService(redisClient);
const sorobanEscrowService = new SorobanEscrowService();

/**
 * Session No-Show Detection Worker
 * 
 * Runs at scheduled_start + grace_period (default: 10 minutes) for each confirmed booking.
 * 
 * Logic:
 * 1. Check if mentor has joined (mentor_joined_at is set)
 * 2. If not joined, verify mentor is not currently online
 * 3. Update booking status to 'no_show'
 * 4. Initiate automatic Soroban escrow refund to mentee
 * 5. Send notifications to both mentor and mentee
 * 6. Log audit trail
 * 
 * Idempotency: Uses booking status check to prevent duplicate processing
 */
async function processNoShowCheck(
  job: Job<SessionNoShowJobData>,
): Promise<void> {
  const { bookingId, mentorId, menteeId, scheduledStart, gracePeriodMinutes } = job.data;

  logger.info('Processing no-show check', { 
    jobId: job.id, 
    bookingId,
    scheduledStart,
    gracePeriodMinutes,
  });

  // Fetch current booking state from database (authoritative source)
  const { rows } = await pool.query<{
    id: string;
    status: string;
    mentor_joined_at: Date | null;
    mentee_joined_at: Date | null;
    escrow_id: string | null;
    escrow_contract_address: string | null;
    amount: string;
    currency: string;
  }>(
    `SELECT id, status, mentor_joined_at, mentee_joined_at, 
            escrow_id, escrow_contract_address, amount, currency
     FROM bookings 
     WHERE id = $1`,
    [bookingId]
  );

  const booking = rows[0];

  if (!booking) {
    logger.warn('Booking not found during no-show check', { bookingId });
    return;
  }

  // Skip if booking is no longer in 'confirmed' status
  // This handles cases where booking was cancelled, completed, or already marked as no_show
  if (booking.status !== 'confirmed') {
    logger.info('No-show check skipped — booking status changed', {
      bookingId,
      status: booking.status,
    });
    return;
  }

  // Check if mentor has joined
  if (booking.mentor_joined_at) {
    logger.info('No-show check skipped — mentor already joined', {
      bookingId,
      mentorJoinedAt: booking.mentor_joined_at,
    });
    return;
  }

  // Double-check mentor presence (in case they just joined and DB hasn't updated yet)
  const mentorActive = await presenceService.isMentorActive(mentorId);
  if (mentorActive) {
    logger.info('No-show check skipped — mentor is currently active', {
      bookingId,
      mentorId,
    });
    return;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CONFIRMED NO-SHOW: Mentor did not join within grace period
  // ══════════════════════════════════════════════════════════════════════════

  const noShowDetectedAt = new Date();

  logger.warn('No-show detected — initiating refund process', {
    bookingId,
    mentorId,
    menteeId,
    scheduledStart,
    gracePeriodMinutes,
    noShowDetectedAt,
  });

  // Step 1: Update booking status to 'no_show'
  await pool.query(
    `UPDATE bookings 
     SET status = $1, 
         no_show_detected_at = $2,
         updated_at = NOW()
     WHERE id = $3`,
    ['no_show', noShowDetectedAt, bookingId]
  );

  logger.info('Booking status updated to no_show', { bookingId });

  // Step 2: Initiate Soroban escrow refund (if escrow exists)
  let refundTxHash: string | null = null;

  if (booking.escrow_id && booking.escrow_contract_address) {
    try {
      const refundResult = await sorobanEscrowService.refund({
        escrowId: booking.escrow_id,
        contractAddress: booking.escrow_contract_address,
        refundedBy: SYSTEM_USER_ID,
      });

      refundTxHash = refundResult.txHash;

      // Record refund transaction hash
      await pool.query(
        `UPDATE bookings 
         SET no_show_refund_tx_hash = $1,
             payment_status = 'refunded',
             updated_at = NOW()
         WHERE id = $2`,
        [refundTxHash, bookingId]
      );

      logger.info('Escrow refund initiated successfully', {
        bookingId,
        escrowId: booking.escrow_id,
        txHash: refundTxHash,
      });
    } catch (error) {
      logger.error('Failed to initiate escrow refund', {
        bookingId,
        escrowId: booking.escrow_id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // Continue with notifications even if refund fails
      // Manual intervention may be required for refund
    }
  } else {
    logger.warn('No escrow found for no-show booking', {
      bookingId,
      escrowId: booking.escrow_id,
    });
  }

  // Step 3: Send notifications to both parties
  try {
    // Notify mentee (received automatic refund)
    await NotificationService.sendNotification({
      userId: menteeId,
      type: 'session_no_show',
      title: 'Session No-Show - Automatic Refund Issued',
      message: `Your mentor did not join the session scheduled for ${new Date(scheduledStart).toLocaleString()}. A full refund has been automatically processed to your wallet.`,
      channels: ['email', 'in_app', 'push'],
      data: {
        bookingId,
        mentorId,
        scheduledStart,
        refundAmount: booking.amount,
        currency: booking.currency,
        refundTxHash,
      },
    });

    // Notify mentor (warning about no-show)
    await NotificationService.sendNotification({
      userId: mentorId,
      type: 'session_no_show',
      title: 'Session No-Show Recorded',
      message: `You did not join the session scheduled for ${new Date(scheduledStart).toLocaleString()}. The mentee has been automatically refunded. Repeated no-shows may affect your account standing.`,
      channels: ['email', 'in_app', 'push'],
      data: {
        bookingId,
        menteeId,
        scheduledStart,
        gracePeriodMinutes,
      },
    });

    logger.info('No-show notifications sent', {
      bookingId,
      mentorId,
      menteeId,
    });
  } catch (error) {
    logger.error('Failed to send no-show notifications', {
      bookingId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  // Step 4: Log audit trail
  await AuditLoggerService.logEvent({
    level: LogLevel.WARN,
    action: AuditAction.ADMIN_ACTION,
    message: `Session no-show detected and processed`,
    userId: SYSTEM_USER_ID,
    entityType: 'booking',
    entityId: bookingId,
    metadata: {
      mentorId,
      menteeId,
      scheduledStart,
      gracePeriodMinutes,
      noShowDetectedAt,
      refundTxHash,
      escrowId: booking.escrow_id,
      trigger: 'auto-no-show-detection',
    },
  });

  logger.info('No-show processing completed', {
    bookingId,
    refundTxHash,
  });
}

/**
 * Worker instance for session no-show detection
 */
export const sessionNoShowWorker = new Worker<SessionNoShowJobData>(
  QUEUE_NAMES.SESSION_NO_SHOW,
  processNoShowCheck,
  {
    connection: redisConnection,
    concurrency: CONCURRENCY.SESSION_NO_SHOW,
  },
);

sessionNoShowWorker.on('completed', (job) => {
  logger.info('No-show check job completed', {
    jobId: job.id,
    bookingId: job.data.bookingId,
  });
});

sessionNoShowWorker.on('failed', (job, err) => {
  logger.error('No-show check job failed', {
    jobId: job?.id,
    bookingId: job?.data.bookingId,
    error: err.message,
  });
});

sessionNoShowWorker.on('error', (err) => {
  logger.error('Session no-show worker error', { error: err.message });
});
