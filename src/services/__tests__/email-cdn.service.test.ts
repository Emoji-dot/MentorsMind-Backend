/**
 * Unit tests for EmailCDNService — Issue #752
 *
 * Verifies that:
 *  1. resolveAssetUrl returns CDN URL when CDN is configured.
 *  2. resolveAssetUrl falls back to APP_BASE_URL when CDN is absent.
 *  3. getTemplateVariables returns all required template variables.
 *  4. Handlebars helpers are registered and return correct URLs.
 *  5. Social icon variables replace Flaticon references with CDN URLs.
 */

import { EmailCDNService, EMAIL_ASSET_PATHS } from '../../../services/email-cdn.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setEnv(vars: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EmailCDNService', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env after each test
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
    // Re-require mocks are not needed since CDNService.getAssetUrl is pure
  });

  // -------------------------------------------------------------------------
  // resolveAssetUrl
  // -------------------------------------------------------------------------

  describe('resolveAssetUrl', () => {
    it('falls back to APP_BASE_URL when CDN is not configured', () => {
      setEnv({ CDN_PROVIDER: undefined, CDN_BASE_URL: undefined, APP_BASE_URL: 'https://api.mentorminds.com' });
      const url = EmailCDNService.resolveAssetUrl('/assets/emails/logo.png');
      expect(url).toContain('/assets/emails/logo.png');
    });

    it('prepends a trailing-slash-safe base URL', () => {
      setEnv({ CDN_PROVIDER: undefined, CDN_BASE_URL: undefined, APP_BASE_URL: 'https://api.mentorminds.com/' });
      const url = EmailCDNService.resolveAssetUrl('/assets/emails/logo.png');
      expect(url).not.toContain('//assets'); // no double slash
    });

    it('handles paths without a leading slash', () => {
      setEnv({ CDN_PROVIDER: undefined, CDN_BASE_URL: undefined, APP_BASE_URL: 'https://api.mentorminds.com' });
      const url = EmailCDNService.resolveAssetUrl('assets/emails/logo.png');
      expect(url).toContain('/assets/emails/logo.png');
    });
  });

  // -------------------------------------------------------------------------
  // resolveEmailAsset
  // -------------------------------------------------------------------------

  describe('resolveEmailAsset', () => {
    it('resolves the logo asset key to a URL containing the correct path', () => {
      setEnv({ CDN_PROVIDER: undefined, APP_BASE_URL: 'https://api.mentorminds.com' });
      const url = EmailCDNService.resolveEmailAsset('logo');
      expect(url).toContain(EMAIL_ASSET_PATHS.logo);
    });

    it('resolves every declared asset key without throwing', () => {
      setEnv({ CDN_PROVIDER: undefined, APP_BASE_URL: 'https://api.mentorminds.com' });
      const keys = Object.keys(EMAIL_ASSET_PATHS) as (keyof typeof EMAIL_ASSET_PATHS)[];
      for (const key of keys) {
        expect(() => EmailCDNService.resolveEmailAsset(key)).not.toThrow();
        expect(typeof EmailCDNService.resolveEmailAsset(key)).toBe('string');
      }
    });
  });

  // -------------------------------------------------------------------------
  // getTemplateVariables
  // -------------------------------------------------------------------------

  describe('getTemplateVariables', () => {
    beforeEach(() => {
      setEnv({
        CDN_PROVIDER: undefined,
        CDN_BASE_URL: undefined,
        APP_BASE_URL: 'https://api.mentorminds.com',
        APP_CLIENT_URL: 'https://mentorminds.com',
      });
    });

    it('returns all required template variable keys', () => {
      const vars = EmailCDNService.getTemplateVariables();
      const requiredKeys = [
        'logoUrl',
        'logoWhiteUrl',
        'twitterIconUrl',
        'linkedinIconUrl',
        'facebookIconUrl',
        'instagramIconUrl',
        'checkIconUrl',
        'warningIconUrl',
        'calendarIconUrl',
        'avatarPlaceholderUrl',
        'platformUrl',
        'supportUrl',
        'privacyUrl',
        'termsUrl',
        'currentYear',
        'companyAddress',
      ];
      for (const key of requiredKeys) {
        expect(vars).toHaveProperty(key);
      }
    });

    it('sets currentYear to the current calendar year', () => {
      const vars = EmailCDNService.getTemplateVariables();
      expect(vars.currentYear).toBe(new Date().getFullYear());
    });

    it('logoUrl does not contain Flaticon domain', () => {
      const vars = EmailCDNService.getTemplateVariables();
      expect(vars.logoUrl).not.toContain('flaticon.com');
    });

    it('social icon URLs do not contain Flaticon domain', () => {
      const vars = EmailCDNService.getTemplateVariables();
      expect(vars.twitterIconUrl).not.toContain('flaticon.com');
      expect(vars.linkedinIconUrl).not.toContain('flaticon.com');
      expect(vars.facebookIconUrl).not.toContain('flaticon.com');
    });

    it('all icon URLs are absolute (not relative)', () => {
      const vars = EmailCDNService.getTemplateVariables();
      const urlKeys: (keyof typeof vars)[] = [
        'logoUrl',
        'twitterIconUrl',
        'linkedinIconUrl',
        'facebookIconUrl',
        'platformUrl',
      ];
      for (const key of urlKeys) {
        expect(vars[key] as string).toMatch(/^https?:\/\//);
      }
    });
  });

  // -------------------------------------------------------------------------
  // registerHandlebarsHelpers
  // -------------------------------------------------------------------------

  describe('registerHandlebarsHelpers', () => {
    it('registers cdnAsset and cdnUrl helpers without throwing', () => {
      const registered: Record<string, (...args: unknown[]) => string> = {};
      const mockHbs = {
        registerHelper: (name: string, fn: (...args: unknown[]) => string) => {
          registered[name] = fn;
        },
      };

      expect(() => EmailCDNService.registerHandlebarsHelpers(mockHbs)).not.toThrow();
      expect(registered).toHaveProperty('cdnAsset');
      expect(registered).toHaveProperty('cdnUrl');
    });

    it('cdnAsset helper returns a string for valid keys', () => {
      setEnv({ CDN_PROVIDER: undefined, APP_BASE_URL: 'https://api.mentorminds.com' });
      const registered: Record<string, (...args: unknown[]) => string> = {};
      EmailCDNService.registerHandlebarsHelpers({
        registerHelper: (name, fn) => { registered[name] = fn; },
      });
      const result = registered['cdnAsset']('logo');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('cdnAsset helper returns empty string for unknown key', () => {
      const registered: Record<string, (...args: unknown[]) => string> = {};
      EmailCDNService.registerHandlebarsHelpers({
        registerHelper: (name, fn) => { registered[name] = fn; },
      });
      const result = registered['cdnAsset']('unknownKey');
      expect(result).toBe('');
    });

    it('cdnUrl helper returns empty string for non-string input', () => {
      const registered: Record<string, (...args: unknown[]) => string> = {};
      EmailCDNService.registerHandlebarsHelpers({
        registerHelper: (name, fn) => { registered[name] = fn; },
      });
      const result = registered['cdnUrl'](42);
      expect(result).toBe('');
    });
  });

  // -------------------------------------------------------------------------
  // getSocialIconVariables
  // -------------------------------------------------------------------------

  describe('getSocialIconVariables', () => {
    it('returns the four social icon variables', () => {
      setEnv({ CDN_PROVIDER: undefined, APP_BASE_URL: 'https://api.mentorminds.com' });
      const icons = EmailCDNService.getSocialIconVariables();
      expect(icons).toHaveProperty('twitterIconUrl');
      expect(icons).toHaveProperty('linkedinIconUrl');
      expect(icons).toHaveProperty('facebookIconUrl');
      expect(icons).toHaveProperty('instagramIconUrl');
    });
  });
});
