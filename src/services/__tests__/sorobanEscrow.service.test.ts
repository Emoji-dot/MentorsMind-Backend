import { SorobanEscrowService } from '../sorobanEscrow.service';
import { env } from '../../config/env';

// Mock everything needed by SorobanEscrowService
jest.mock('../../config/env', () => ({
  env: {
    SOROBAN_RPC_URL: 'http://localhost:8000',
    SOROBAN_NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
    ESCROW_CONTRACT_ID: 'CC_TEST_CONTRACT_ID',
    PLATFORM_PRIVATE_KEY: 'SA_TEST_SECRET_KEY',
    PLATFORM_PUBLIC_KEY: 'GA_TEST_PUBLIC_KEY',
  }
}));

// We can mock the stellar-sdk to avoid making actual RPC calls during unit tests.
jest.mock('@stellar/stellar-sdk', () => {
  const original = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...original,
    rpc: {
      ...original.rpc,
      Server: jest.fn().mockImplementation(() => ({
        getAccount: jest.fn().mockResolvedValue({ sequenceNumber: () => '1' }),
        getLatestLedger: jest.fn().mockResolvedValue({ sequence: 100 }),
        prepareTransaction: jest.fn().mockImplementation((tx) => Promise.resolve(tx)),
        sendTransaction: jest.fn().mockResolvedValue({ status: 'PENDING', hash: 'hash123' }),
        getTransaction: jest.fn().mockResolvedValue({ status: 'SUCCESS', returnValue: { _value: 'some-value' } }),
      }))
    },
  };
});

describe('SorobanEscrowService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isConfigured', () => {
    it('returns true when configured', () => {
      expect(SorobanEscrowService.isConfigured()).toBe(true);
    });
  });

  describe('createEscrow', () => {
    it('creates escrow and returns details', async () => {
      const result = await SorobanEscrowService.createEscrow({
        bookingId: 'booking-1',
        learnerId: 'learner-1',
        mentorId: 'mentor-1',
        amount: '100',
        currency: 'USDC' // non-native
      });

      expect(result).toHaveProperty('contractAddress');
      expect(result).toHaveProperty('escrowId');
      expect(result).toHaveProperty('txHash');
      expect(result.txHash).toBe('hash123');
    });

    it('creates escrow with native currency', async () => {
      const result = await SorobanEscrowService.createEscrow({
        bookingId: 'booking-2',
        learnerId: 'learner-1',
        mentorId: 'mentor-1',
        amount: '100',
        currency: 'XLM' // native
      });

      expect(result).toHaveProperty('contractAddress');
    });
  });

  describe('releaseFunds', () => {
    it('releases funds successfully', async () => {
      const result = await SorobanEscrowService.releaseFunds({
        escrowId: 'escrow-1',
        releasedBy: 'learner-1',
      });

      expect(result.txHash).toBe('hash123');
    });
  });

  describe('refund', () => {
    it('refunds successfully', async () => {
      const result = await SorobanEscrowService.refund({
        escrowId: 'escrow-1',
        refundedBy: 'learner-1',
        amount: '50'
      });

      expect(result.txHash).toBe('hash123');
    });
  });

  describe('resolveDispute', () => {
    it('resolves dispute successfully', async () => {
      const result = await SorobanEscrowService.resolveDispute({
        escrowId: 'escrow-1',
        resolvedBy: 'admin-1',
        splitPercentage: 60
      });

      expect(result.txHash).toBe('hash123');
    });
  });
});
