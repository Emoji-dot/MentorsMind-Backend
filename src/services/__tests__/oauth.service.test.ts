/**
 * Unit tests for OAuthService — Issue #835 (OAuth2/OIDC integration)
 *
 * Verifies that listAvailableProviders/getAllProviderNames/isProviderEnabled
 * correctly reflect which providers have credentials configured via env vars.
 */

function setEnv(vars: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

const ALL_OAUTH_ENV_KEYS = [
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET',
  'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET',
  'LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET',
  'MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET',
];

describe('OAuthService', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear all OAuth-related env vars before each test, then re-require
    // the modules so oauth.config.ts re-evaluates process.env freshly.
    for (const key of ALL_OAUTH_ENV_KEYS) {
      delete process.env[key];
    }
    jest.resetModules();
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  describe('getAllProviderNames', () => {
    it('returns all four known provider names regardless of configuration', () => {
      const { OAuthService } = require('../oauth.service');
      const names = OAuthService.getAllProviderNames();
      expect(names.sort()).toEqual(['github', 'google', 'linkedin', 'microsoft']);
    });
  });

  describe('listAvailableProviders', () => {
    it('returns an empty list when no OAuth credentials are configured', async () => {
      const { OAuthService } = require('../oauth.service');
      const providers = await OAuthService.listAvailableProviders();
      expect(providers).toEqual([]);
    });

    it('returns only google when only google credentials are set', async () => {
      setEnv({ GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret' });
      const { OAuthService } = require('../oauth.service');
      const providers = await OAuthService.listAvailableProviders();
      expect(providers).toEqual(['google']);
    });

    it('returns linkedin and microsoft when their credentials are set', async () => {
      setEnv({
        LINKEDIN_CLIENT_ID: 'lid',
        LINKEDIN_CLIENT_SECRET: 'lsecret',
        MICROSOFT_CLIENT_ID: 'mid',
        MICROSOFT_CLIENT_SECRET: 'msecret',
      });
      const { OAuthService } = require('../oauth.service');
      const providers = await OAuthService.listAvailableProviders();
      expect(providers.sort()).toEqual(['linkedin', 'microsoft']);
    });

    it('does not enable a provider when only one of clientId/clientSecret is set', async () => {
      setEnv({ MICROSOFT_CLIENT_ID: 'mid-only' });
      const { OAuthService } = require('../oauth.service');
      const providers = await OAuthService.listAvailableProviders();
      expect(providers).not.toContain('microsoft');
    });

    it('returns all providers when all credentials are configured', async () => {
      setEnv({
        GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret',
        GITHUB_CLIENT_ID: 'ghid', GITHUB_CLIENT_SECRET: 'ghsecret',
        LINKEDIN_CLIENT_ID: 'lid', LINKEDIN_CLIENT_SECRET: 'lsecret',
        MICROSOFT_CLIENT_ID: 'mid', MICROSOFT_CLIENT_SECRET: 'msecret',
      });
      const { OAuthService } = require('../oauth.service');
      const providers = await OAuthService.listAvailableProviders();
      expect(providers.sort()).toEqual(['github', 'google', 'linkedin', 'microsoft']);
    });
  });

  describe('isProviderEnabled', () => {
    it('resolves false for an unconfigured provider', async () => {
      const { OAuthService } = require('../oauth.service');
      await expect(OAuthService.isProviderEnabled('linkedin')).resolves.toBe(false);
    });

    it('resolves true for a configured provider', async () => {
      setEnv({ LINKEDIN_CLIENT_ID: 'lid', LINKEDIN_CLIENT_SECRET: 'lsecret' });
      const { OAuthService } = require('../oauth.service');
      await expect(OAuthService.isProviderEnabled('linkedin')).resolves.toBe(true);
    });

    it('resolves false for an unknown provider name', async () => {
      const { OAuthService } = require('../oauth.service');
      await expect(OAuthService.isProviderEnabled('not-a-provider')).resolves.toBe(false);
    });
  });
});
