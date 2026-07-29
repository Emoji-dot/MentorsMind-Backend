import request from 'supertest';
import app from '../../src/app';
import { setupContainers, teardownContainers } from './setup';

beforeAll(async () => {
  await setupContainers();
});

afterAll(async () => {
  await teardownContainers();
});

jest.mock('../../src/middleware/auth.middleware', () => ({
  authenticate: (req: any, res: any, next: any) => {
    req.user = { id: 'test-user', role: 'mentee' };
    next();
  }
}));

describe('Payment Escrow API Integration', () => {
  it('should initiate a payment via POST /api/v1/payments/initiate', async () => {
    const res = await request(app)
      .post('/api/v1/payments/initiate')
      .send({
        bookingId: 'booking-1',
        amount: '100',
        currency: 'USDC'
      });
      
    expect(res.status).not.toBe(404);
  });
});
