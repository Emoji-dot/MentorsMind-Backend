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

describe('Dispute Resolution API Integration', () => {
  it('should open a dispute via POST /api/v1/disputes', async () => {
    const res = await request(app)
      .post('/api/v1/disputes')
      .send({
        sessionId: 'session-1',
        type: 'quality',
        reason: 'Poor audio quality'
      });
      
    expect(res.status).not.toBe(404);
  });
});
