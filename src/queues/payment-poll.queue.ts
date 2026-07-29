import { createManagedQueue, buildJobOptions, JobConfig } from './queue.manager';
import { defaultJobOptions, QUEUE_NAMES } from './queue.config';

export interface PaymentPollJobData {
  paymentId: string;
  userId: string;
  transactionHash: string | null;
}

export const paymentPollQueue = createManagedQueue<PaymentPollJobData>(
  QUEUE_NAMES.PAYMENT_POLL,
  {
    defaultJobOptions: {
      ...defaultJobOptions,
      // Poll every 30 seconds, up to 20 attempts (10 minutes total)
      attempts: 20,
      backoff: { type: 'fixed', delay: 30_000 },
    },
  },
);

/**
 * Enqueue a payment status poll job.
 * The worker will check the Stellar network for the transaction status.
 */
export async function enqueuePaymentPoll(
  data: PaymentPollJobData,
  options?: Partial<JobConfig>,
): Promise<void> {
  // Deduplicate by paymentId — only one active poll per payment
  await paymentPollQueue.add(
    options?.name ?? 'poll-payment',
    data,
    {
      ...buildJobOptions(options),
      jobId: `payment-poll:${data.paymentId}`,
    },
  );
}
