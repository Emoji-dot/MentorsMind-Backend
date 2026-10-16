jest.mock('../errorHandler', () => ({ createError: jest.fn((code: string) => Object.assign(new Error(code), { code })) }));
jest.mock('../../utils/logger.utils', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));
jest.mock('../../config/database', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

const mockGet = jest.fn();
const mockSet = jest.fn();
jest.mock('../../services/cache.service', () => ({
  CacheService: {
    get: (...a: unknown[]) => mockGet(...a),
    set: (...a: unknown[]) => mockSet(...a),
    invalidatePattern: jest.fn(),
  },
}));

import pool from '../../config/database';
import { env } from '../../config/env';
import {
  isTokenRevokedCached,
  jwtExpiryToSeconds,
  revocationCacheKey,
  stopAuthDebounceCleanup,
} from '../auth.middleware';

const query = (pool as unknown as { query: jest.Mock }).query;
const iat = 1_700_000_000_000;
const expectedTtl = jwtExpiryToSeconds(env.JWT_EXPIRES_IN);

describe('token revocation cache', () => {
  beforeEach(() => jest.clearAllMocks());
  afterAll(() => stopAuthDebounceCleanup());

  it('builds the key as auth:revoked:{userId}:{tokenIat}', () => {
    expect(revocationCacheKey('u1', iat)).toBe(`auth:revoked:u1:${iat}`);
  });

  it('converts JWT expiry strings to seconds', () => {
    expect(jwtExpiryToSeconds('15m')).toBe(900);
    expect(jwtExpiryToSeconds('1h')).toBe(3600);
    expect(jwtExpiryToSeconds('30s')).toBe(30);
    expect(jwtExpiryToSeconds('900')).toBe(900);
  });

  it('cache hit ("valid") returns without querying the DB', async () => {
    mockGet.mockResolvedValue('valid');
    await expect(isTokenRevokedCached('u1', iat)).resolves.toBe(false);
    expect(query).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('cache hit ("revoked") returns true without querying the DB', async () => {
    mockGet.mockResolvedValue('revoked');
    await expect(isTokenRevokedCached('u1', iat)).resolves.toBe(true);
    expect(query).not.toHaveBeenCalled();
  });

  it('cache miss queries the DB and caches "valid" with the JWT_EXPIRES_IN TTL', async () => {
    mockGet.mockResolvedValue(null);
    query.mockResolvedValue({ rows: [{ token_invalid_before: null, deletion_completed_at: null }] });

    await expect(isTokenRevokedCached('u1', iat)).resolves.toBe(false);

    expect(query).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(`auth:revoked:u1:${iat}`, 'valid', expectedTtl);
  });

  it('cache miss caches "revoked" when token_invalid_before is after iat', async () => {
    mockGet.mockResolvedValue(null);
    query.mockResolvedValue({
      rows: [{ token_invalid_before: new Date(iat + 1000), deletion_completed_at: null }],
    });

    await expect(isTokenRevokedCached('u1', iat)).resolves.toBe(true);
    expect(mockSet).toHaveBeenCalledWith(`auth:revoked:u1:${iat}`, 'revoked', expectedTtl);
  });
});
