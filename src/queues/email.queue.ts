import type { EmailRequest } from '../services/email.service';
import { createManagedQueue, buildJobOptions, JobConfig } from './queue.manager';
import { JOB_RATE_LIMITS, QUEUE_NAMES } from './queue.config';
import { captureJobTraceData, JobTraceData } from '../utils/trace-context.utils';

export interface EmailJobData extends EmailRequest, JobTraceData {
  jobType: 'send-email';
}

export const emailQueue = createManagedQueue<EmailJobData>(QUEUE_NAMES.EMAIL, {
  limiter: JOB_RATE_LIMITS.EMAIL,
});

/**
 * Enqueue an email send job.
 * @param data - Email request payload
 * @param priorityOrConfig - Optional BullMQ priority or advanced job config
 */
export async function enqueueEmail(
  data: EmailRequest,
  priorityOrConfig?: number | Partial<JobConfig>,
): Promise<void> {
  const options: Partial<JobConfig> =
    typeof priorityOrConfig === 'number'
      ? { priority: priorityOrConfig }
      : priorityOrConfig ?? {};

  await emailQueue.add(
    options.name ?? 'send-email',
    {
      ...data,
      jobType: 'send-email',
      ...captureJobTraceData(),
    },
    buildJobOptions(options),
  );
}
