/**
 * Verification Service Tests (issue #768)
 *
 * Uses the same lightweight harness as smart-scheduling.service.test.ts.
 * Run via:  npm run test:verification
 *
 * Coverage:
 *  - retryPendingOnChainVerifications skips verifications that failed
 *    RETRY_BACKOFF_THRESHOLD times until the 24h backoff window has elapsed.
 *  - retryPendingOnChainVerifications retries again once the backoff window
 *    has elapsed.
 */

import { describe, it, expect } from './test-harness';
import pool from '../../config/database';
import { VerificationService } from '../verification.service';

const mentorId = 'mentor-1';

function installMockPool(rows: any[]) {
  const original = pool.query.bind(pool);
  const updateCalls: any[] = [];
  (pool as any).query = async (text: string, params: any[] = []) => {
    if (text.includes('WHERE on_chain_pending = TRUE')) {
      return { rows };
    }
    if (text.startsWith('UPDATE mentor_verifications')) {
      updateCalls.push({ text, params });
      return { rows: [] };
    }
    return { rows: [] };
  };
  return { updateCalls, restore: () => ((pool as any).query = original) };
}

function withStubbedTrigger<T>(impl: () => Promise<string | null>, fn: () => Promise<T>) {
  const original = VerificationService.triggerOnChainVerification;
  (VerificationService as any).triggerOnChainVerification = impl;
  return fn().finally(() => {
    (VerificationService as any).triggerOnChainVerification = original;
  });
}

describe('VerificationService.retryPendingOnChainVerifications — exponential backoff', () => {
  it('skips a verification that failed 3+ times within the last 24h', async () => {
    const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000);
    const { updateCalls, restore } = installMockPool([
      {
        id: 'verification-1',
        mentor_id: mentorId,
        retry_count: 3,
        last_retry_at: oneHourAgo,
        on_chain_pending: true,
      },
    ]);
    let triggerCalled = false;
    try {
      await withStubbedTrigger(async () => {
        triggerCalled = true;
        return 'tx-hash';
      }, () => VerificationService.retryPendingOnChainVerifications());
      expect(triggerCalled).toBeFalsy();
      expect(updateCalls.length).toBe(0);
    } finally {
      restore();
    }
  });

  it('retries a verification that failed 3+ times once 24h have elapsed', async () => {
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const { updateCalls, restore } = installMockPool([
      {
        id: 'verification-2',
        mentor_id: mentorId,
        retry_count: 3,
        last_retry_at: twentyFiveHoursAgo,
        on_chain_pending: true,
      },
    ]);
    let triggerCalled = false;
    try {
      const successCount = await withStubbedTrigger(async () => {
        triggerCalled = true;
        return 'tx-hash-2';
      }, () => VerificationService.retryPendingOnChainVerifications());
      expect(triggerCalled).toBeTruthy();
      expect(successCount).toBe(1);
      expect(updateCalls.length).toBe(1);
    } finally {
      restore();
    }
  });

  it('always retries a verification below the backoff threshold', async () => {
    const { updateCalls, restore } = installMockPool([
      {
        id: 'verification-3',
        mentor_id: mentorId,
        retry_count: 1,
        last_retry_at: new Date(),
        on_chain_pending: true,
      },
    ]);
    let triggerCalled = false;
    try {
      await withStubbedTrigger(async () => {
        triggerCalled = true;
        return null;
      }, () => VerificationService.retryPendingOnChainVerifications());
      expect(triggerCalled).toBeTruthy();
      // A null txHash (e.g. VERIFICATION_CONTRACT_ADDRESS unset) is treated
      // as "still pending" rather than a failure — no DB update either way.
      expect(updateCalls.length).toBe(0);
    } finally {
      restore();
    }
  });
});
