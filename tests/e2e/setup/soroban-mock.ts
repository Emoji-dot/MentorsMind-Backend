/**
 * soroban-mock.ts
 *
 * Replaces all Soroban RPC network calls with deterministic in-process stubs.
 *
 * The mock fully implements the `SorobanEscrowClient` interface defined in
 * src/services/sorobanEscrow.service.ts so that:
 *   - create_escrow  → records state in memory, returns a mock tx hash
 *   - release_funds  → transitions escrow status to 'released'
 *   - refund         → transitions escrow status to 'refunded'
 *   - open_dispute   → transitions escrow status to 'disputed'
 *   - resolve_dispute → transitions escrow status to 'resolved'
 *
 * No real network calls are ever made during tests.
 */

import type {
  SorobanEscrowClient,
  SorobanEscrowState,
  SorobanInvocationResult,
} from '../../../src/services/sorobanEscrow.service';

// ─── In-memory escrow store ───────────────────────────────────────────────────

export type MockEscrowStatus =
  | 'pending'
  | 'funded'
  | 'released'
  | 'disputed'
  | 'resolved'
  | 'refunded'
  | 'cancelled';

export interface MockEscrow {
  escrowId: string;
  contractAddress: string;
  learnerId: string;
  mentorId: string;
  amount: string;
  currency: string;
  status: MockEscrowStatus;
  txHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const mockEscrowStore = new Map<string, MockEscrow>();
let escrowCounter = 0;

export function generateMockEscrowId(): string {
  return `mock-escrow-${++escrowCounter}-${Date.now()}`;
}

export function generateMockTxHash(method: string): string {
  return `mock-soroban-tx-${method}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getMockEscrow(escrowId: string): MockEscrow | undefined {
  return mockEscrowStore.get(escrowId);
}

export function getAllMockEscrows(): MockEscrow[] {
  return Array.from(mockEscrowStore.values());
}

export function clearMockEscrows(): void {
  mockEscrowStore.clear();
  escrowCounter = 0;
}

// ─── Mock SorobanEscrowClient implementation ──────────────────────────────────

export class MockSorobanEscrowClient implements SorobanEscrowClient {
  // Track all calls for assertion in tests
  public readonly calls: Array<{ method: string; args: unknown[]; result: unknown }> = [];

  private record(method: string, args: unknown[], result: unknown): void {
    this.calls.push({ method, args, result });
  }

  clearCalls(): void {
    this.calls.length = 0;
  }

  async simulate(params: { contractAddress: string; method: string; args: unknown[] }): Promise<void> {
    // Simulate always succeeds in tests — the real Soroban simulate is a pre-flight
    // that validates XDR; we skip this in tests.
    this.record('simulate', [params], undefined);
  }

  async invoke(params: {
    contractAddress: string;
    method: string;
    args: unknown[];
  }): Promise<SorobanInvocationResult> {
    const txHash = generateMockTxHash(params.method);

    switch (params.method) {
      case 'create_escrow': {
        const [learnerId, mentorId, amount, currency] = params.args as [
          string,
          string,
          string,
          string,
        ];
        const escrowId = generateMockEscrowId();
        const escrow: MockEscrow = {
          escrowId,
          contractAddress: params.contractAddress,
          learnerId,
          mentorId,
          amount,
          currency,
          status: 'funded',
          txHash,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        mockEscrowStore.set(escrowId, escrow);
        const result: SorobanInvocationResult = { txHash, result: { escrowId } };
        this.record(params.method, params.args, result);
        return result;
      }

      case 'release_funds': {
        const [escrowId] = params.args as [string];
        const escrow = mockEscrowStore.get(escrowId);
        if (escrow) {
          escrow.status = 'released';
          escrow.updatedAt = new Date();
        }
        const result: SorobanInvocationResult = { txHash, result: { success: true } };
        this.record(params.method, params.args, result);
        return result;
      }

      case 'refund': {
        const [escrowId] = params.args as [string];
        const escrow = mockEscrowStore.get(escrowId);
        if (escrow) {
          escrow.status = 'refunded';
          escrow.updatedAt = new Date();
        }
        const result: SorobanInvocationResult = { txHash, result: { success: true } };
        this.record(params.method, params.args, result);
        return result;
      }

      case 'open_dispute': {
        const [escrowId] = params.args as [string];
        const escrow = mockEscrowStore.get(escrowId);
        if (escrow) {
          escrow.status = 'disputed';
          escrow.updatedAt = new Date();
        }
        const result: SorobanInvocationResult = { txHash, result: { success: true } };
        this.record(params.method, params.args, result);
        return result;
      }

      case 'resolve_dispute': {
        const [escrowId, _resolution] = params.args as [string, string];
        const escrow = mockEscrowStore.get(escrowId);
        if (escrow) {
          escrow.status = 'resolved';
          escrow.updatedAt = new Date();
        }
        const result: SorobanInvocationResult = { txHash, result: { success: true } };
        this.record(params.method, params.args, result);
        return result;
      }

      case 'get_escrow': {
        const [escrowId] = params.args as [string];
        const escrow = mockEscrowStore.get(escrowId);
        const result: SorobanInvocationResult = {
          txHash: null,
          result: escrow || null,
        };
        this.record(params.method, params.args, result);
        return result;
      }

      default: {
        const result: SorobanInvocationResult = { txHash, result: { success: true } };
        this.record(params.method, params.args, result);
        return result;
      }
    }
  }

  async getEscrowState(
    _contractAddress: string,
    escrowId: string,
  ): Promise<SorobanEscrowState> {
    const escrow = mockEscrowStore.get(escrowId);
    if (!escrow) {
      return { status: 'not_found' };
    }
    return {
      status: escrow.status,
      escrowId: escrow.escrowId,
      txHash: escrow.txHash,
    };
  }

  streamPendingEscrows(
    _contractAddress: string,
    _onState: (state: SorobanEscrowState) => Promise<void> | void,
  ): () => void {
    // No-op — tests control escrow state directly via mockEscrowStore
    return () => {};
  }
}

// ─── Singleton mock instance ──────────────────────────────────────────────────

export const mockSorobanClient = new MockSorobanEscrowClient();

// ─── Jest module mock installation ───────────────────────────────────────────

/**
 * Call once at the top of any test file that exercises Soroban code paths.
 *
 * After calling this, all production code that does:
 *   `import { SorobanEscrowService } from '../services/sorobanEscrow.service'`
 * will receive a version backed by `mockSorobanClient` with no network calls.
 */
export function installSorobanMocks(): void {
  jest.mock('../../../src/services/sorobanEscrow.service', () => {
    const originalModule = jest.requireActual('../../../src/services/sorobanEscrow.service');

    return {
      ...originalModule,
      SorobanEscrowService: {
        // createEscrow: store in-memory + update bookings table
        createEscrow: jest.fn(async (input: {
          bookingId: string;
          learnerId: string;
          mentorId: string;
          amount: string;
          currency: string;
        }) => {
          const { default: pool } = await import('../../../src/config/database');
          // Use a deterministic contractAddress for tests
          const contractAddress = `MOCK_CONTRACT_${input.bookingId.slice(0, 8).toUpperCase()}`;
          const invocationResult = await mockSorobanClient.invoke({
            contractAddress,
            method: 'create_escrow',
            args: [input.learnerId, input.mentorId, input.amount, input.currency],
          });
          const escrowId = (invocationResult.result as { escrowId: string }).escrowId;

          // Persist escrow record in DB so workers can query it
          await pool.query(
            `INSERT INTO escrows (id, learner_id, mentor_id, amount, currency, status, stellar_tx_hash, description)
             VALUES ($1, $2, $3, $4, $5, 'funded', $6, 'E2E test escrow')
             ON CONFLICT (id) DO NOTHING`,
            [escrowId, input.learnerId, input.mentorId, input.amount, input.currency, invocationResult.txHash],
          );

          // Link escrow to the booking
          await pool.query(
            `UPDATE bookings SET escrow_id = $1, escrow_contract_address = $2 WHERE id = $3`,
            [escrowId, contractAddress, input.bookingId],
          );

          return { escrowId, contractAddress, txHash: invocationResult.txHash };
        }),

        // releaseEscrow: transition status → released
        releaseEscrow: jest.fn(async (escrowId: string, _releasedBy: string) => {
          const { default: pool } = await import('../../../src/config/database');
          await mockSorobanClient.invoke({
            contractAddress: 'MOCK_CONTRACT',
            method: 'release_funds',
            args: [escrowId],
          });
          await pool.query(
            `UPDATE escrows SET status = 'released', released_at = NOW() WHERE id = $1`,
            [escrowId],
          );
          // Also update the linked booking's payment_status
          await pool.query(
            `UPDATE bookings SET payment_status = 'paid' WHERE escrow_id = $1`,
            [escrowId],
          );
          return { success: true, txHash: generateMockTxHash('release_funds') };
        }),

        // refundEscrow: transition status → refunded
        refundEscrow: jest.fn(async (escrowId: string, _refundedBy: string) => {
          const { default: pool } = await import('../../../src/config/database');
          await mockSorobanClient.invoke({
            contractAddress: 'MOCK_CONTRACT',
            method: 'refund',
            args: [escrowId],
          });
          await pool.query(
            `UPDATE escrows SET status = 'refunded', refunded_at = NOW() WHERE id = $1`,
            [escrowId],
          );
          await pool.query(
            `UPDATE bookings SET payment_status = 'refunded' WHERE escrow_id = $1`,
            [escrowId],
          );
          return { success: true, txHash: generateMockTxHash('refund') };
        }),

        // openDisputeOnEscrow: transition status → disputed
        openDisputeOnEscrow: jest.fn(async (escrowId: string) => {
          const { default: pool } = await import('../../../src/config/database');
          await mockSorobanClient.invoke({
            contractAddress: 'MOCK_CONTRACT',
            method: 'open_dispute',
            args: [escrowId],
          });
          await pool.query(
            `UPDATE escrows SET status = 'disputed' WHERE id = $1`,
            [escrowId],
          );
          return { success: true, txHash: generateMockTxHash('open_dispute') };
        }),

        // getEscrowStatus: read from mock store
        getEscrowStatus: jest.fn(async (escrowId: string) => {
          const { default: pool } = await import('../../../src/config/database');
          const { rows } = await pool.query(
            'SELECT status FROM escrows WHERE id = $1',
            [escrowId],
          );
          return rows[0]?.status ?? 'not_found';
        }),

        // startPendingEscrowMonitoring: no-op in tests
        startPendingEscrowMonitoring: jest.fn(),
      },
    };
  });
}

/**
 * Reset mock call counters between tests without clearing the escrow store.
 */
export function resetSorobanMocks(): void {
  mockSorobanClient.clearCalls();
}
