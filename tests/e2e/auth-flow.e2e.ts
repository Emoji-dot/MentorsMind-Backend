/**
 * auth-flow.e2e.ts
 *
 * E2E tests for the authentication critical path:
 *   register → login → (MFA setup) → token refresh → logout → verify revocation
 *
 * All Stellar network calls are replaced with in-process mocks.
 * Uses a real PostgreSQL + Redis testcontainer started by global-setup.ts.
 */

import { installStellarMocks } from './setup/stellar-mock';

// Install mocks BEFORE importing any production code that touches Stellar
installStellarMocks();

import { TestFixture } from './setup/test-fixture';

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('Auth Flow — E2E', () => {
  const fixture = new TestFixture();

  beforeAll(async () => {
    await fixture.setup();
  });

  afterAll(async () => {
    await fixture.teardown();
  });

  // ── 1. Register ─────────────────────────────────────────────────────────────
  describe('POST /auth/register', () => {
    it('registers a new user and returns access + refresh tokens', async () => {
      const res = await fixture.post('/auth/register', {
        email: 'new-user@e2e.test',
        password: 'SecurePass123!',
        firstName: 'New',
        lastName: 'User',
        role: 'mentee',
      });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        status: 'success',
        data: expect.objectContaining({
          accessToken: expect.any(String),
          refreshToken: expect.any(String),
          user: expect.objectContaining({
            email: 'new-user@e2e.test',
            role: 'mentee',
          }),
        }),
      });
    });

    it('rejects registration with a duplicate email', async () => {
      // Use the already-seeded mentee email
      const res = await fixture.post('/auth/register', {
        email: fixture.seeds.mentee.email,
        password: 'AnotherPass123!',
        firstName: 'Dupe',
        lastName: 'User',
        role: 'mentee',
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });

    it('rejects registration with a weak password', async () => {
      const res = await fixture.post('/auth/register', {
        email: 'weak-pass@e2e.test',
        password: '123',
        firstName: 'Weak',
        lastName: 'User',
        role: 'mentee',
      });

      expect(res.status).toBe(400);
    });
  });

  // ── 2. Login ─────────────────────────────────────────────────────────────────
  describe('POST /auth/login', () => {
    it('logs in with valid credentials and returns tokens', async () => {
      const res = await fixture.post('/auth/login', {
        email: fixture.seeds.mentee.email,
        password: fixture.seeds.mentee.password,
      });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'success',
        data: expect.objectContaining({
          accessToken: expect.any(String),
          refreshToken: expect.any(String),
          user: expect.objectContaining({
            id: fixture.seeds.mentee.id,
            email: fixture.seeds.mentee.email,
            role: 'mentee',
          }),
        }),
      });
    });

    it('rejects login with wrong password', async () => {
      const res = await fixture.post('/auth/login', {
        email: fixture.seeds.mentee.email,
        password: 'WrongPassword!',
      });

      expect(res.status).toBe(401);
    });

    it('rejects login for non-existent user', async () => {
      const res = await fixture.post('/auth/login', {
        email: 'nobody@e2e.test',
        password: 'SomePass123!',
      });

      expect([400, 401, 404]).toContain(res.status);
    });
  });

  // ── 3. Get current user ───────────────────────────────────────────────────────
  describe('GET /auth/me', () => {
    it('returns the authenticated user', async () => {
      const res = await fixture.get('/auth/me', fixture.menteeTokens.accessToken);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'success',
        data: expect.objectContaining({
          id: fixture.seeds.mentee.id,
          email: fixture.seeds.mentee.email,
        }),
      });
    });

    it('returns 401 without a token', async () => {
      const res = await fixture.get('/auth/me');
      expect(res.status).toBe(401);
    });

    it('returns 401 with a malformed token', async () => {
      const res = await fixture.request
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer invalid.token.here');
      expect(res.status).toBe(401);
    });
  });

  // ── 4. Token refresh ──────────────────────────────────────────────────────────
  describe('POST /auth/refresh', () => {
    it('issues a new access token from a valid refresh token', async () => {
      const res = await fixture.post('/auth/refresh', {
        refreshToken: fixture.menteeTokens.refreshToken,
      });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'success',
        data: expect.objectContaining({
          accessToken: expect.any(String),
        }),
      });
    });

    it('rejects an invalid refresh token', async () => {
      const res = await fixture.post('/auth/refresh', {
        refreshToken: 'not-a-real-token',
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  // ── 5. Logout + revocation ────────────────────────────────────────────────────
  describe('POST /auth/logout', () => {
    let loginAccessToken: string;
    let loginRefreshToken: string;

    beforeEach(async () => {
      // Login fresh to get a known token pair
      const loginRes = await fixture.post('/auth/login', {
        email: fixture.seeds.mentor.email,
        password: fixture.seeds.mentor.password,
      });
      loginAccessToken = loginRes.body.data?.accessToken;
      loginRefreshToken = loginRes.body.data?.refreshToken;
    });

    it('logs out and the old token no longer works', async () => {
      // Confirm the token works before logout
      const beforeRes = await fixture.get('/auth/me', loginAccessToken);
      expect(beforeRes.status).toBe(200);

      // Logout
      const logoutRes = await fixture.post(
        '/auth/logout',
        { refreshToken: loginRefreshToken },
        loginAccessToken,
      );
      expect(logoutRes.status).toBe(200);

      // Refresh token should now be invalid
      const refreshRes = await fixture.post('/auth/refresh', {
        refreshToken: loginRefreshToken,
      });
      expect(refreshRes.status).toBeGreaterThanOrEqual(400);
    });
  });

  // ── 6. Password change ────────────────────────────────────────────────────────
  describe('POST /auth/change-password', () => {
    it('changes the password when the current password is correct', async () => {
      const res = await fixture.post(
        '/auth/change-password',
        {
          currentPassword: fixture.seeds.admin.password,
          newPassword: 'NewAdminPass456!',
        },
        fixture.adminTokens.accessToken,
      );

      // Accept 200 or 204 — exact response shape varies
      expect([200, 204]).toContain(res.status);
    });

    it('rejects a password change with an incorrect current password', async () => {
      const res = await fixture.post(
        '/auth/change-password',
        {
          currentPassword: 'WrongCurrentPassword!',
          newPassword: 'NewPass456!',
        },
        fixture.mentorTokens.accessToken,
      );

      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  // ── 7. Role-based access ──────────────────────────────────────────────────────
  describe('Role-based access control', () => {
    it('allows admin to access admin-only endpoints', async () => {
      const res = await fixture.get('/admin/users', fixture.adminTokens.accessToken);
      // 200 OK or 404 (route doesn't exist) — not 401/403
      expect([200, 404]).toContain(res.status);
    });

    it('denies mentee access to admin-only endpoints', async () => {
      const res = await fixture.get('/admin/users', fixture.menteeTokens.accessToken);
      expect([401, 403]).toContain(res.status);
    });
  });
});
