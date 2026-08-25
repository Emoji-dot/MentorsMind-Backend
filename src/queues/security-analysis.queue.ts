import { Queue } from 'bullmq';
import {
  redisConnection,
  defaultJobOptions,
  QUEUE_NAMES,
} from '../config/queue';

export interface SecurityAnalysisJobData {
  userId: string;
  ip: string;
  userAgent: string;
  timestamp: string;
}

export const securityAnalysisQueue = new Queue<SecurityAnalysisJobData>(
  QUEUE_NAMES.SECURITY_ANALYSIS,
  {
    connection: redisConnection,
    defaultJobOptions,
  }
);

/**
 * Enqueue a security-analysis job for a login/access event.
 * The worker runs ThreatDetectionService.analyzeLoginEvent and, if a threat
 * is detected, IncidentResponseService.handle.
 */
export async function enqueueSecurityAnalysis(
  data: SecurityAnalysisJobData
): Promise<void> {
  await securityAnalysisQueue.add('analyze-security-event', data);
}
