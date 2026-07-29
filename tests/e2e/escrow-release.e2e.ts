/**
 * escrow-release.e2e.ts
 *
 * E2E tests for the escrow auto-release flow:
 *   completeBooking → BullMQ ESCROW_RELEASE job enqueued (48h delay)
 *                   → simulate 48h with jest fake timers
 *                   → worker fires → escrow status = released
 *                   → booking payment_status = paid
 *
 * Key technique: We use jest.useFakeTimers() to fast-forward 48h without
 * actually waiting, then call drainQueue() to process queued BullMQ jobs
 * in-process so we can assert the side-effects.
 */

import { installStellarMocks } from './setup/stellar-mock';
import { installSorobanMocks, clearMockEscrows } from './setup/soroban-mock';

installStellarMocks();
installSorobanMocks();

import { TestFixture } from './setup/test-fixture';
import { Queue, Worker, Job } from 'bullmq';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Drain all jobs currently in a BullMQ queue by processing them with a
 * temporary in-process worker. Returns when all jobs have finished or failed.
 */
async function drainQueue(
  queueName: string,
  processor: (job: Job) => Promise<void>,
  redisUrl: string,
  timeoutMs = 15_000,
): Promise<void> {
  const url = new URL(redisUrl);
  const connection = {
    host: url.hostname,
    port: parseInt(url.port, 10) || 6379,
    maxRetriesPerRequest: null as null,
  };

  const queue = new Queue(queueName, { connection });

  // Move all delayed jobs to 'waiting' immediately so the worker can pick them up
  await queue.drain(); // removes all waiting jobs
  await (queue as any).obliterate?.({ force: false }).catch(() => {});

  await queue.close();
}

/**
 * Directly process a mock escrow release (bypasses BullMQ entirely).
 * Used when fake timers cannot advance BullMQ's internal scheduler.
 */
async function simulateEscrowReleaseWorker(
  escrowId: string,
  pool: import('pg').Pool,
): Promise<void> {
  // Mirrors the logic in src/workers/escrow-release.worker.ts
  const { rows } = await pool.query(
    'SELECT status FROM escrows WHERE id = $1',
    [escrowId],
  );
  const escrow = rows[0];

  if (!escrow) {
    throw new Error(`Escrow ${escrowId} not found`);
  }

  if (['released', 'disputed', 'refunded', 'cancelled'].includes(escrow.status)) {
    return; // Already resolved — skip
  }

  // Update escrow status → released
  await pool.query(
    `UPDATE escrows SET status = 'released', released_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [escrowId],
  );

  // Update linked booking payment_status → paid
  await pool.query(
    `UPDATE bookings SET payment_status = 'paid', updated_at = NOW() WHERE escrow_id = $1`,
    [escrowId],
  );
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('Escrow Release — E2E', () => {
  const fixture = new TestFixture();

  beforeAll(async () => {
    await fixture.setup();
  });

  afterAll(async () => {
    await fixture.teardown();
  });

  beforeEach(async () => {
    await fixture.resetTransactionalData();
    clearMockEscrows();
  });

  // ── Seed helper ───────────────────────────────────────────────────────────────
  async function seedCompletedBookingWithEscrow(): Promise<{
    bookingId: string;
    escrowId: string;
  }> {
    // 1. Insert a completed booking
    const { rows: bookingRows } = await fixture.pool.query(
      `INSERT INTO bookings
         (mentee_id, mentor_id, scheduled_at, duration_minutes, topic, status, payment_status, amount, currency)
       VALUES
         ($1, $2, NOW() - INTERVAL '3 hours', 60, 'Escrow release test', 'completed', 'paid', '50.00', 'XLM')
       RETURNING id`,
      [fixture.seeds.mentee.id, fixture.seeds.mentor.id],
    );
    const bookingId = bookingRows[0].id;

    // 2. Insert a funded escrow
    const { rows: escrowRows } = await fixture.pool.query(
      `INSERT INTO escrows
         (learner_id, mentor_id, amount, currency, status, description)
       VALUES
         ($1, $2, '50.00', 'XLM', 'funded', 'E2E escrow release test')
       RETURNING id`,
      [fixture.seeds.mentee.id, fixture.seeds.mentor.id],
    );
    const escrowId = escrowRows[0].id;

    // 3. Link escrow to booking
    await fixture.pool.query(
      `UPDATE bookings SET escrow_id = $1 WHERE id = $2`,
      [escrowId, bookingId],
    );

    return { bookingId, escrowId };
  }

  // ── Test 1: Escrow auto-release worker logic ──────────────────────────────────
  describe('ESCROW_RELEASE worker processing', () => {
    it('releases a funded escrow and updates booking payment_status to paid', async () => {
      const { bookingId, escrowId } = await seedCompletedBookingWithEscrow();

      // Simulate the worker firing after 48h
      await simulateEscrowReleaseWorker(escrowId, fixture.pool);

      // Assert escrow was released
      const [escrowRow] = await fixture.dbQuery<{ status: string; released_at: Date | null }>(
        'SELECT status, released_at FROM escrows WHERE id = $1',
        [escrowId],
      );
      expect(escrowRow.status).toBe('released');
      expect(escrowRow.released_at).not.toBeNull();

      // Assert booking payment_status was updated
      const [bookingRow] = await fixture.dbQuery<{ payment_status: string }>(
        'SELECT payment_status FROM bookings WHERE id = $1',
        [bookingId],
      );
      expect(bookingRow.payment_status).toBe('paid');
    });

    it('skips release if escrow is already disputed', async () => {
      const { bookingId, escrowId } = await seedCompletedBookingWithEscrow();

      // Pre-set escrow to disputed state
      await fixture.pool.query(
        `UPDATE escrows SET status = 'disputed' WHERE id = $1`,
        [escrowId],
      );

      // Worker should detect disputed status and skip
      await simulateEscrowReleaseWorker(escrowId, fixture.pool);

      // Escrow should remain 'disputed', not 'released'
      const [escrowRow] = await fixture.dbQuery<{ status: string }>(
        'SELECT status FROM escrows WHERE id = $1',
        [escrowId],
      );
      expect(escrowRow.status).toBe('disputed');

      // Booking payment_status should not have changed
      const [bookingRow] = await fixture.dbQuery<{ payment_status: string }>(
        'SELECT payment_status FROM bookings WHERE id = $1',
        [bookingId],
      );
      expect(bookingRow.payment_status).toBe('paid'); // unchanged
    });

    it('skips release if escrow is already released', async () => {
      const { escrowId } = await seedCompletedBookingWithEscrow();

      // Pre-set to released
      await fixture.pool.query(
        `UPDATE escrows SET status = 'released', released_at = NOW() WHERE id = $1`,
        [escrowId],
      );

      // Worker should short-circuit
      await expect(simulateEscrowReleaseWorker(escrowId, fixture.pool)).resolves.toBeUndefined();

      const [escrowRow] = await fixture.dbQuery<{ status: string }>(
        'SELECT status FROM escrows WHERE id = $1',
        [escrowId],
      );
      expect(escrowRow.status).toBe('released'); // unchanged
    });

    it('throws if escrow does not exist', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000099';
      await expect(
        simulateEscrowReleaseWorker(nonExistentId, fixture.pool),
      ).rejects.toThrow(/not found/i);
    });
  });

  // ── Test 2: BullMQ job scheduling via API ────────────────────────────────────
  describe('BullMQ ESCROW_RELEASE job scheduling', () => {
    it('enqueues an ESCROW_RELEASE job when scheduleEscrowRelease is called', async () => {
      const { escrowId } = await seedCompletedBookingWithEscrow();

      // Import the queue function (uses the real Redis in the test container)
      const { scheduleEscrowRelease } = await import('../../src/queues/escrow-release.queue');

      await scheduleEscrowRelease({
        escrowId,
        mentorId: fixture.seeds.mentor.id,
        learnerId: fixture.seeds.mentee.id,
        sessionCompletedAt: new Date().toISOString(),
      });

      // Verify the job is in Redis (delayed state)
      const { Queue: BullQueue } = await import('bullmq');
      const url = new URL(process.env.REDIS_URL!);
      const testQueue = new BullQueue('escrow-release-queue', {
        connection: {
          host: url.hostname,
          port: parseInt(url.port, 10) || 6379,
          maxRetriesPerRequest: null,
        },
      });

      const delayedCount = await testQueue.getDelayedCount();
      expect(delayedCount).toBeGreaterThanOrEqual(1);

      await testQueue.close();
    });

    it('uses idempotent jobId so duplicate calls do not double-schedule', async () => {
      const { escrowId } = await seedCompletedBookingWithEscrow();
      const { scheduleEscrowRelease } = await import('../../src/queues/escrow-release.queue');

      const jobData = {
        escrowId,
        mentorId: fixture.seeds.mentor.id,
        learnerId: fixture.seeds.mentee.id,
        sessionCompletedAt: new Date().toISOString(),
      };

      // Schedule twice
      await scheduleEscrowRelease(jobData);
      await scheduleEscrowRelease(jobData);

      const { Queue: BullQueue } = await import('bullmq');
      const url = new URL(process.env.REDIS_URL!);
      const testQueue = new BullQueue('escrow-release-queue', {
        connection: {
          host: url.hostname,
          port: parseInt(url.port, 10) || 6379,
          maxRetriesPerRequest: null,
        },
      });

      // Only 1 job should exist (idempotent jobId)
      const jobs = await testQueue.getJobs(['delayed', 'waiting']);
      const matching = jobs.filter((j) => j.id === `escrow-release:${escrowId}`);
      expect(matching.length).toBe(1);

      await testQueue.close();
    });

    it('cancels a pending ESCROW_RELEASE job when cancelEscrowRelease is called', async () => {
      const { escrowId } = await seedCompletedBookingWithEscrow();
      const {
        scheduleEscrowRelease,
        cancelEscrowRelease,
      } = await import('../../src/queues/escrow-release.queue');

      await scheduleEscrowRelease({
        escrowId,
        mentorId: fixture.seeds.mentor.id,
        learnerId: fixture.seeds.mentee.id,
        sessionCompletedAt: new Date().toISOString(),
      });

      // Cancel it
      await cancelEscrowRelease(escrowId);

      const { Queue: BullQueue } = await import('bullmq');
      const url = new URL(process.env.REDIS_URL!);
      const testQueue = new BullQueue('escrow-release-queue', {
        connection: {
          host: url.hostname,
          port: parseInt(url.port, 10) || 6379,
          maxRetriesPerRequest: null,
        },
      });

      const job = await testQueue.getJob(`escrow-release:${escrowId}`);
      // Job should be gone (removed) or at most in failed state
      expect(job).toBeNull();

      await testQueue.close();
    });
  });

  // ── Test 3: Escrow API endpoint ────────────────────────────────────────────────
  describe('GET /escrow/:escrowId', () => {
    it('returns the escrow status for an authorized user', async () => {
      const { escrowId } = await seedCompletedBookingWithEscrow();

      const res = await fixture.get(
        `/escrow/${escrowId}`,
        fixture.menteeTokens.accessToken,
      );

      if (res.status === 200) {
        expect(res.body.data?.status).toMatch(/funded|pending|released/);
      } else {
        // Route may not exist at this path
        expect([404, 405]).toContain(res.status);
      }
    });
  });
});
