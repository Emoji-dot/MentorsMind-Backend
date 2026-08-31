import { PaymentsService } from '../payments.service';
import pool from '../../config/database';
import { BookingModel } from '../../models/booking.model';
import { stellarService } from '../stellar.service';
import { AssetExchangeService } from '../assetExchange.service';
import { LoyaltyService } from '../loyalty.service';
import { SocketService } from '../socket.service';
import { env } from '../../config/env';

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
    connect: jest.fn()
  }
}));
jest.mock('../../models/booking.model');
jest.mock('../stellar.service');
jest.mock('../assetExchange.service');
jest.mock('../loyalty.service');
jest.mock('../socket.service');
jest.mock('../../config/env', () => ({
  env: {
    PLATFORM_FEE_PERCENTAGE: '5',
    PLATFORM_PUBLIC_KEY: 'G123'
  }
}));

describe('PaymentsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('initiatePayment', () => {
    it('initiates a payment successfully', async () => {
      (BookingModel.findById as jest.Mock).mockResolvedValue({
        id: 'booking-1',
        mentee_id: 'user-1',
        payment_status: 'pending'
      });
      (LoyaltyService.getDiscountBps as jest.Mock).mockResolvedValue(1000); // 10% discount on fee
      (pool.query as jest.Mock).mockResolvedValue({
        rows: [{ id: 'payment-1' }]
      });

      const result = await PaymentsService.initiatePayment({
        userId: 'user-1',
        bookingId: 'booking-1',
        amount: '100',
        currency: 'XLM'
      });

      expect(result.id).toBe('payment-1');
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO transactions'),
        expect.any(Array)
      );
    });

    it('throws if booking not found', async () => {
      (BookingModel.findById as jest.Mock).mockResolvedValue(null);
      await expect(PaymentsService.initiatePayment({
        userId: 'user-1',
        bookingId: 'booking-1',
        amount: '100'
      })).rejects.toThrow('Booking not found');
    });

    it('throws if booking is already paid', async () => {
      (BookingModel.findById as jest.Mock).mockResolvedValue({
        id: 'booking-1',
        mentee_id: 'user-1',
        payment_status: 'paid'
      });
      await expect(PaymentsService.initiatePayment({
        userId: 'user-1',
        bookingId: 'booking-1',
        amount: '100'
      })).rejects.toThrow('Booking is already paid');
    });
  });

  describe('confirmPayment', () => {
    it('confirms a payment successfully', async () => {
      (pool.query as jest.Mock)
        // getPaymentById
        .mockResolvedValueOnce({ rows: [{ id: 'payment-1', status: 'pending', amount: '100', to_address: 'G123', currency: 'XLM' }] })
        // idempotency
        .mockResolvedValueOnce({ rows: [] })
        // update payment
        .mockResolvedValueOnce({ rows: [{ id: 'payment-1', status: 'completed' }] })
        // update booking
        .mockResolvedValueOnce({ rows: [] });
        
      (stellarService.getTransaction as jest.Mock).mockResolvedValue({ successful: true });
      (stellarService.getTransactionOperations as jest.Mock).mockResolvedValue([{
        type: 'payment',
        amount: '100',
        to: 'G123',
        asset_type: 'native'
      }]);

      const result = await PaymentsService.confirmPayment('payment-1', 'user-1', 'hash-1');
      expect(result.status).toBe('completed');
      expect(stellarService.getTransaction).toHaveBeenCalledWith('hash-1');
    });

    it('throws if transaction already processed', async () => {
      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [{ id: 'payment-1', status: 'pending' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'payment-2' }] }); // idempotency check fails

      await expect(PaymentsService.confirmPayment('payment-1', 'user-1', 'hash-1'))
        .rejects.toThrow('This transaction hash has already been used');
    });
  });

  describe('refundPayment', () => {
    it('refunds a completed payment', async () => {
      (pool.query as jest.Mock)
        // getPaymentById
        .mockResolvedValueOnce({ rows: [{ id: 'payment-1', status: 'completed', amount: '100', currency: 'XLM', booking_id: 'booking-1' }] });

      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({}) // BEGIN
          .mockResolvedValueOnce({ rows: [{ id: 'payment-1', status: 'refunded' }] }) // UPDATE payment
          .mockResolvedValueOnce({}) // INSERT refund
          .mockResolvedValueOnce({}) // UPDATE booking
          .mockResolvedValueOnce({}), // COMMIT
        release: jest.fn()
      };
      (pool.connect as jest.Mock).mockResolvedValue(mockClient);

      const result = await PaymentsService.refundPayment('payment-1', 'user-1', undefined, 'Test reason', 'hash-1');
      expect(result.status).toBe('refunded');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });
  });
});
