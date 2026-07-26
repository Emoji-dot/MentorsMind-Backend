/**
 * Smart Scheduling Service Tests (issue #717)
 *
 * Uses the same lightweight harness as src/validators/__tests__/test-harness.ts.
 * Run via:  npm run test:smart-scheduling
 *
 * Coverage:
 *  - suggestOptimalTimes excludes the booking-being-rescheduled's own slot
 *    from the conflict set when `excludeBookingId` is passed, so a booking's
 *    original time is not treated as conflicting with itself.
 */

import { describe, it, expect } from './test-harness';
import { DateTime } from 'luxon';
import pool from '../../config/database';
import { SmartSchedulingService } from '../smart-scheduling.service';

const mentorId = 'mentor-1';
const menteeId = 'mentee-1';
const bookingXId = 'booking-x';

const day = DateTime.fromISO('2026-08-03T00:00:00.000Z');
const conflictStart = day.plus({ hours: 14 }).toJSDate();
const conflictEnd = day.plus({ hours: 15 }).toJSDate();
const windowStart = day.plus({ hours: 14 }).toJSDate();
const windowEnd = day.plus({ hours: 16 }).toJSDate();

const existingBookingRows = [
  { id: bookingXId, scheduled_start: conflictStart, scheduled_end: conflictEnd },
];

function installMockPool() {
  const original = pool.query.bind(pool);
  (pool as any).query = async (text: string, params: any[] = []) => {
    if (text.includes('FROM users')) {
      return {
        rows: [
          { id: mentorId, timezone: 'UTC', availability_schedule: null },
          { id: menteeId, timezone: 'UTC', availability_schedule: null },
        ],
      };
    }
    if (text.includes('WHERE mentor_id = $1') && text.includes('scheduled_start >=')) {
      const excludeId = params[3];
      const rows = existingBookingRows.filter((b) => !excludeId || b.id !== excludeId);
      return { rows };
    }
    if (text.includes('WHERE mentee_id = $1') && text.includes('scheduled_start >=')) {
      return { rows: [] };
    }
    if (text.includes('(mentor_id = $1 OR mentee_id = $2)')) {
      return { rows: [] };
    }
    return { rows: [] };
  };
  return () => {
    (pool as any).query = original;
  };
}

describe('SmartSchedulingService.suggestOptimalTimes — self-conflict exclusion', () => {
  it('excludes the reschedule target booking without excludeBookingId (baseline: slot is filtered)', async () => {
    const restore = installMockPool();
    try {
      const suggestions = await SmartSchedulingService.suggestOptimalTimes(
        mentorId,
        menteeId,
        60,
        windowStart,
        windowEnd,
      );
      const hasConflictSlot = suggestions.some(
        (s) => s.suggestedTimes[0].start.getTime() === conflictStart.getTime(),
      );
      expect(hasConflictSlot).toBeFalsy();
    } finally {
      restore();
    }
  });

  it('includes the booking-being-rescheduled original slot when excludeBookingId is passed', async () => {
    const restore = installMockPool();
    try {
      const suggestions = await SmartSchedulingService.suggestOptimalTimes(
        mentorId,
        menteeId,
        60,
        windowStart,
        windowEnd,
        bookingXId,
      );
      const hasConflictSlot = suggestions.some(
        (s) => s.suggestedTimes[0].start.getTime() === conflictStart.getTime(),
      );
      expect(hasConflictSlot).toBeTruthy();
    } finally {
      restore();
    }
  });
});

describe('SmartSchedulingService.suggestOptimalTimes — 30-day suggestion horizon', () => {
  it('caps the suggestion window at 30 days even when a further endDate is requested', async () => {
    const restore = installMockPool();
    try {
      const start = day.toJSDate();
      const farEnd = day.plus({ days: 120 }).toJSDate();
      const suggestions = await SmartSchedulingService.suggestOptimalTimes(
        mentorId,
        menteeId,
        60,
        start,
        farEnd,
      );
      const maxAllowed = day.plus({ days: 30 }).endOf('day').toMillis();
      const withinHorizon = suggestions.every(
        (s) => s.suggestedTimes[0].start.getTime() <= maxAllowed,
      );
      expect(withinHorizon).toBeTruthy();
    } finally {
      restore();
    }
  });
});
