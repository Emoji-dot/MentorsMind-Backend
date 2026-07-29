import { createManagedQueue, buildJobOptions, enableJobResultCache, JobConfig } from './queue.manager';
import { QUEUE_NAMES } from './queue.config';

export type ReportType = 'weekly-earnings';

export interface ReportJobData {
  reportType: ReportType;
  /** ISO date string for the report period start */
  periodStart: string;
  /** ISO date string for the report period end */
  periodEnd: string;
  /** Optional mentor ID — if omitted, generates platform-wide report */
  mentorId?: string;
}

export const reportQueue = createManagedQueue<ReportJobData>(QUEUE_NAMES.REPORT);

// Cache report job outcomes for tenant dashboards and monitoring.
enableJobResultCache(reportQueue, 6 * 3600);

/**
 * Enqueue a weekly earnings report generation job.
 */
export async function enqueueWeeklyEarningsReport(
  mentorId?: string,
  options?: Partial<JobConfig>,
): Promise<void> {
  const now = new Date();
  const periodEnd = now.toISOString();
  const periodStart = new Date(
    now.getTime() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  await reportQueue.add(
    options?.name ?? 'weekly-earnings',
    { reportType: 'weekly-earnings', periodStart, periodEnd, mentorId },
    {
      ...buildJobOptions(options),
      jobId: `weekly-earnings:${mentorId ?? 'platform'}:${periodStart.slice(0, 10)}`,
    },
  );
}
