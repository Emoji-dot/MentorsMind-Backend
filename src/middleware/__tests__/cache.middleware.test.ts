/**
 * Cache Middleware Tests (issue #716)
 *
 * Uses the same lightweight harness as cors.middleware.test.ts.
 * Run via:  npm run test:cache
 *
 * Coverage:
 *  1. signUserId — deterministic HMAC signing, no plaintext userId leakage
 *  2. Cache key collision — two different users produce different signed keys
 *     so one user's cached response can never be served to another user.
 */

import { describe, it, expect } from './cors-test-harness';
import { signUserId } from '../cache.middleware';

describe('signUserId — deterministic HMAC signing', () => {
  it('produces the same signature for the same userId', () => {
    const a = signUserId('user-123');
    const b = signUserId('user-123');
    expect(a).toBe(b);
  });

  it('does not leak the plaintext userId in the signature', () => {
    const signed = signUserId('user-123');
    expect(signed.includes('user-123')).toBeFalsy();
  });
});

describe('signUserId — cache key collision prevention', () => {
  it('produces different signatures for different users', () => {
    const userA = signUserId('user-aaa');
    const userB = signUserId('user-bbb');
    expect(userA === userB).toBeFalsy();
  });

  it('builds non-colliding cache keys for the same route across two users', () => {
    const route = '/api/v1/users/me';
    const keyA = `mm:http:${signUserId('user-aaa')}:${route}`;
    const keyB = `mm:http:${signUserId('user-bbb')}:${route}`;
    expect(keyA === keyB).toBeFalsy();
  });
});
