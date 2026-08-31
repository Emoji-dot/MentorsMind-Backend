import { AuthService } from '../auth.service';
import pool from '../../config/database';
import { TokenService } from '../token.service';
import bcrypt from 'bcryptjs';

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
  }
}));
jest.mock('../token.service');
jest.mock('bcryptjs');

describe('AuthService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('registers a user successfully', async () => {
      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [] }) // check email
        .mockResolvedValueOnce({ rows: [{ id: 'user-1', role: 'learner', user_tier: 'free' }] }); // insert
      (bcrypt.genSalt as jest.Mock).mockResolvedValue('salt');
      (bcrypt.hash as jest.Mock).mockResolvedValue('hash');
      (TokenService.issueTokens as jest.Mock).mockResolvedValue({ accessToken: 'acc', refreshToken: 'ref' });

      const result = await AuthService.register({
        email: 'test@test.com',
        password: 'Password123!',
        firstName: 'John',
        lastName: 'Doe',
        role: 'learner'
      });

      expect(result.userId).toBe('user-1');
      expect(result.accessToken).toBe('acc');
    });

    it('throws if email exists', async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ id: 'user-1' }] });
      
      await expect(AuthService.register({
        email: 'test@test.com',
        password: 'Password123!',
        firstName: 'John',
        lastName: 'Doe',
        role: 'learner'
      })).rejects.toThrow('Email is already registered');
    });
  });

  describe('login', () => {
    it('logs in a user successfully', async () => {
      (pool.query as jest.Mock).mockResolvedValue({
        rows: [{ id: 'user-1', role: 'learner', status: 'active', password_hash: 'hash' }]
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (TokenService.issueTokens as jest.Mock).mockResolvedValue({ accessToken: 'acc', refreshToken: 'ref' });

      const result = await AuthService.login({ email: 'test@test.com', password: 'Password123!' });
      
      expect(result.tokens.accessToken).toBe('acc');
    });

    it('throws if user not found', async () => {
      (pool.query as jest.Mock).mockResolvedValue({ rows: [] });
      await expect(AuthService.login({ email: 'test@test.com', password: 'Password123!' }))
        .rejects.toThrow('Invalid email or password');
    });

    it('throws if invalid password', async () => {
      (pool.query as jest.Mock).mockResolvedValue({
        rows: [{ id: 'user-1', role: 'learner', status: 'active', password_hash: 'hash' }]
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(AuthService.login({ email: 'test@test.com', password: 'Wrong' }))
        .rejects.toThrow('Invalid email or password');
    });
  });

  describe('refresh', () => {
    it('refreshes token', async () => {
      (TokenService.rotateRefreshToken as jest.Mock).mockResolvedValue({ accessToken: 'acc', refreshToken: 'ref' });
      const result = await AuthService.refresh('old-ref');
      expect(result.accessToken).toBe('acc');
    });
  });

  describe('forgotPassword', () => {
    it('generates a reset token', async () => {
      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [{ id: 'user-1' }] })
        .mockResolvedValueOnce({ rows: [] }); // Update

      const token = await AuthService.forgotPassword('test@test.com');
      expect(token).toBeTruthy();
    });
  });

  describe('resetPassword', () => {
    it('resets the password', async () => {
      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [{ id: 'user-1' }] }) // Find token
        .mockResolvedValueOnce({ rows: [] }); // Update password
      (bcrypt.genSalt as jest.Mock).mockResolvedValue('salt');
      (bcrypt.hash as jest.Mock).mockResolvedValue('new-hash');

      const result = await AuthService.resetPassword({ token: 'test-token', newPassword: 'NewPassword123!' });
      expect(result).toBe('user-1');
    });
  });
});
