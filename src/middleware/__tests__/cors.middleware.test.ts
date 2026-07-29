/**
 * CORS Middleware Tests
 *
 * Uses the same lightweight harness as src/validators/__tests__/test-harness.ts.
 * Run via:  npm run test:cors
 *
 * Coverage:
 *  1. buildOriginMatcher — plain, glob wildcard, explicit regex
 *  2. isOriginAllowed    — allowed/blocked, case sensitivity, wildcard passthrough
 *  3. validateCorsForEnvironment — production guard throws on '*'
 *  4. buildCorsMiddleware — OPTIONS preflight (allowed & blocked origins, max-age)
 *  5. Platform headers   — ALLOWED_HEADERS & EXPOSED_HEADERS completeness
 */

import { describe, it, expect } from './cors-test-harness';
import {
  buildOriginMatcher,
  isOriginAllowed,
  validateCorsForEnvironment,
  buildCorsMiddleware,
  ALLOWED_HEADERS,
  EXPOSED_HEADERS,
} from '../../middleware/cors.middleware';
import http from 'http';

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Fires a real OPTIONS preflight request against an in-process HTTP server
 * backed by the CORS middleware under test.
 */
async function preflightRequest(opts: {
  origins: string[];
  maxAge?: number;
  requestOrigin: string;
}): Promise<{ status: number; headers: Record<string, string | undefined> }> {
  const { origins, maxAge = 86400, requestOrigin } = opts;

  const middleware = buildCorsMiddleware({
    origins,
    maxAge,
    nodeEnv: 'development',
  });

  // Build a minimal Express-like handler
  const server = http.createServer((req, res) => {
    // Express-compatible stub
    const next = (err?: unknown) => {
      if (err) {
        const status =
          typeof err === 'object' && err !== null && 'status' in err
            ? (err as { status: number }).status
            : 500;
        res.writeHead(status);
        res.end('CORS error');
      } else {
        res.writeHead(204);
        res.end();
      }
    };

    // Attach express-like helpers that the cors package uses
    (res as any).setHeader = res.setHeader.bind(res);
    (res as any).getHeader = res.getHeader.bind(res);
    (res as any).removeHeader = res.removeHeader.bind(res);
    (res as any).writeHead = res.writeHead.bind(res);
    (res as any).statusCode = 200;
    (req as any).method = req.method;
    (req as any).headers = req.headers;

    middleware(req as any, res as any, next as any);
  });

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      const options = {
        hostname: '127.0.0.1',
        port: addr.port,
        path: '/api/test',
        method: 'OPTIONS',
        headers: {
          Origin: requestOrigin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type,X-MFA-Code',
        },
      };

      const req = http.request(options, (res) => {
        const headers: Record<string, string | undefined> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
        }
        server.close();
        resolve({ status: res.statusCode ?? 0, headers });
      });

      req.on('error', (err) => {
        server.close();
        reject(err);
      });

      req.end();
    });
  });
}

// ─── 1. buildOriginMatcher ───────────────────────────────────────────────────

describe('buildOriginMatcher — plain string', () => {
  it('returns a plain string for a simple URL', () => {
    const matcher = buildOriginMatcher('https://app.mentorminds.com');
    expect(typeof matcher).toBe('string');
    expect(matcher as string).toBe('https://app.mentorminds.com');
  });

  it('trims surrounding whitespace', () => {
    const matcher = buildOriginMatcher('  https://app.mentorminds.com  ');
    expect(matcher as string).toBe('https://app.mentorminds.com');
  });
});

describe('buildOriginMatcher — glob wildcard', () => {
  it('converts https://*.mentorminds.com to a RegExp', () => {
    const matcher = buildOriginMatcher('https://*.mentorminds.com');
    expect(matcher instanceof RegExp).toBeTruthy();
  });

  it('matches a valid subdomain', () => {
    const re = buildOriginMatcher('https://*.mentorminds.com') as RegExp;
    expect(re.test('https://app.mentorminds.com')).toBeTruthy();
    expect(re.test('https://admin.mentorminds.com')).toBeTruthy();
  });

  it('does not match a second-level subdomain (deep nesting)', () => {
    const re = buildOriginMatcher('https://*.mentorminds.com') as RegExp;
    // [^.]+ means the wildcard segment cannot itself contain a dot
    expect(re.test('https://evil.app.mentorminds.com')).toBeFalsy();
  });

  it('does not match an unrelated domain', () => {
    const re = buildOriginMatcher('https://*.mentorminds.com') as RegExp;
    expect(re.test('https://evil.com')).toBeFalsy();
  });

  it('does not match a path-injection attempt', () => {
    const re = buildOriginMatcher('https://*.mentorminds.com') as RegExp;
    expect(
      re.test('https://evil.com?x=https://app.mentorminds.com'),
    ).toBeFalsy();
  });
});

describe('buildOriginMatcher — explicit regex prefix', () => {
  it('compiles a regex: prefix into a RegExp', () => {
    const matcher = buildOriginMatcher(
      'regex:^https://[a-z]+-mentorminds\\.com$',
    );
    expect(matcher instanceof RegExp).toBeTruthy();
  });

  it('matches valid patterns', () => {
    const re = buildOriginMatcher(
      'regex:^https://[a-z]+-mentorminds\\.com$',
    ) as RegExp;
    expect(re.test('https://app-mentorminds.com')).toBeTruthy();
    expect(re.test('https://staging-mentorminds.com')).toBeTruthy();
  });

  it('rejects non-matching patterns', () => {
    const re = buildOriginMatcher(
      'regex:^https://[a-z]+-mentorminds\\.com$',
    ) as RegExp;
    expect(re.test('https://evil.com')).toBeFalsy();
  });
});

// ─── 2. isOriginAllowed ──────────────────────────────────────────────────────

describe('isOriginAllowed — plain exact match', () => {
  const matchers = [buildOriginMatcher('https://app.mentorminds.com')];

  it('allows an exact match', () => {
    expect(
      isOriginAllowed('https://app.mentorminds.com', matchers),
    ).toBeTruthy();
  });

  it('blocks a different origin', () => {
    expect(isOriginAllowed('https://evil.com', matchers)).toBeFalsy();
  });
});

describe('isOriginAllowed — wildcard passthrough', () => {
  const matchers = [buildOriginMatcher('*')];

  it('allows any origin when wildcard is present', () => {
    expect(isOriginAllowed('https://anything.com', matchers)).toBeTruthy();
    expect(isOriginAllowed('https://evil.com', matchers)).toBeTruthy();
  });
});

describe('isOriginAllowed — subdomain pattern', () => {
  const matchers = [buildOriginMatcher('https://*.mentorminds.com')];

  it('allows valid subdomains', () => {
    expect(
      isOriginAllowed('https://app.mentorminds.com', matchers),
    ).toBeTruthy();
    expect(
      isOriginAllowed('https://admin.mentorminds.com', matchers),
    ).toBeTruthy();
  });

  it('blocks deep nesting', () => {
    expect(
      isOriginAllowed('https://sub.app.mentorminds.com', matchers),
    ).toBeFalsy();
  });

  it('blocks unrelated domains', () => {
    expect(isOriginAllowed('https://evil.com', matchers)).toBeFalsy();
  });
});

describe('isOriginAllowed — case insensitive plain match', () => {
  const matchers = [buildOriginMatcher('https://App.MentorMinds.COM')];

  it('allows same origin with different casing', () => {
    expect(
      isOriginAllowed('https://app.mentorminds.com', matchers),
    ).toBeTruthy();
  });
});

describe('isOriginAllowed — multiple allowed origins', () => {
  const matchers = [
    buildOriginMatcher('https://app.mentorminds.com'),
    buildOriginMatcher('https://admin.mentorminds.com'),
  ];

  it('allows both configured origins', () => {
    expect(
      isOriginAllowed('https://app.mentorminds.com', matchers),
    ).toBeTruthy();
    expect(
      isOriginAllowed('https://admin.mentorminds.com', matchers),
    ).toBeTruthy();
  });

  it('blocks any origin not in the list', () => {
    expect(isOriginAllowed('https://attacker.com', matchers)).toBeFalsy();
  });
});

// ─── 3. validateCorsForEnvironment — production guard ───────────────────────

describe('validateCorsForEnvironment — development', () => {
  it('does not call process.exit when wildcard is used in development', () => {
    let exitCalled = false;
    const original = process.exit;
    (process.exit as any) = () => {
      exitCalled = true;
    };
    try {
      validateCorsForEnvironment(['*'], 'development');
      expect(exitCalled).toBeFalsy();
    } finally {
      process.exit = original;
    }
  });

  it('does not call process.exit for specific origins in production', () => {
    let exitCalled = false;
    const original = process.exit;
    (process.exit as any) = () => {
      exitCalled = true;
    };
    try {
      validateCorsForEnvironment(
        ['https://app.mentorminds.com'],
        'production',
      );
      expect(exitCalled).toBeFalsy();
    } finally {
      process.exit = original;
    }
  });
});

describe('validateCorsForEnvironment — production guard', () => {
  it('calls process.exit(1) when wildcard is used in production', () => {
    let exitCalledWith: number | undefined;
    const originalExit = process.exit;
    (process.exit as any) = (code: number) => {
      exitCalledWith = code;
    };
    try {
      validateCorsForEnvironment(['*'], 'production');
      expect(exitCalledWith).toBe(1);
    } finally {
      process.exit = originalExit;
    }
  });

  it('exits even when wildcard is mixed with valid origins', () => {
    let exitCalledWith: number | undefined;
    const originalExit = process.exit;
    (process.exit as any) = (code: number) => {
      exitCalledWith = code;
    };
    try {
      validateCorsForEnvironment(
        ['https://app.mentorminds.com', '*'],
        'production',
      );
      expect(exitCalledWith).toBe(1);
    } finally {
      process.exit = originalExit;
    }
  });
});

// ─── 4. buildCorsMiddleware — HTTP integration ───────────────────────────────

describe('buildCorsMiddleware — allowed origin (preflight)', () => {
  it('returns 204 and sets Access-Control-Allow-Origin for a known origin', async () => {
    const result = await preflightRequest({
      origins: ['https://app.mentorminds.com'],
      requestOrigin: 'https://app.mentorminds.com',
    });
    expect(result.status).toBe(204);
    expect(result.headers['access-control-allow-origin']).toBe(
      'https://app.mentorminds.com',
    );
  });

  it('echoes the specific origin (not *) when credentials is true', async () => {
    const result = await preflightRequest({
      origins: ['https://app.mentorminds.com'],
      requestOrigin: 'https://app.mentorminds.com',
    });
    const origin = result.headers['access-control-allow-origin'];
    expect(origin !== '*').toBeTruthy();
    expect(origin).toBe('https://app.mentorminds.com');
  });
});

describe('buildCorsMiddleware — blocked origin', () => {
  it('returns 403 for an origin that is not in the allowed list', async () => {
    const result = await preflightRequest({
      origins: ['https://app.mentorminds.com'],
      requestOrigin: 'https://evil.com',
    });
    expect(result.status).toBe(403);
  });

  it('does not set Access-Control-Allow-Origin header for blocked origin', async () => {
    const result = await preflightRequest({
      origins: ['https://app.mentorminds.com'],
      requestOrigin: 'https://evil.com',
    });
    const header = result.headers['access-control-allow-origin'];
    expect(!header).toBeTruthy();
  });
});

describe('buildCorsMiddleware — subdomain wildcard (preflight)', () => {
  it('allows a valid subdomain of https://*.mentorminds.com', async () => {
    const result = await preflightRequest({
      origins: ['https://*.mentorminds.com'],
      requestOrigin: 'https://app.mentorminds.com',
    });
    expect(result.status).toBe(204);
  });

  it('blocks an unrelated domain when only subdomain wildcard is set', async () => {
    const result = await preflightRequest({
      origins: ['https://*.mentorminds.com'],
      requestOrigin: 'https://evil.com',
    });
    expect(result.status).toBe(403);
  });
});

describe('buildCorsMiddleware — preflight max-age', () => {
  it('sets Access-Control-Max-Age to the configured value', async () => {
    const result = await preflightRequest({
      origins: ['https://app.mentorminds.com'],
      maxAge: 3600,
      requestOrigin: 'https://app.mentorminds.com',
    });
    expect(result.headers['access-control-max-age']).toBe('3600');
  });

  it('uses 86400 when maxAge is not overridden', async () => {
    const result = await preflightRequest({
      origins: ['https://app.mentorminds.com'],
      requestOrigin: 'https://app.mentorminds.com',
    });
    expect(result.headers['access-control-max-age']).toBe('86400');
  });
});

describe('buildCorsMiddleware — allowed headers', () => {
  it('includes platform headers in Access-Control-Allow-Headers', async () => {
    const result = await preflightRequest({
      origins: ['https://app.mentorminds.com'],
      requestOrigin: 'https://app.mentorminds.com',
    });
    const allowed =
      result.headers['access-control-allow-headers']?.toLowerCase() ?? '';
    expect(allowed.includes('idempotency-key')).toBeTruthy();
    expect(allowed.includes('x-mfa-code')).toBeTruthy();
    expect(allowed.includes('x-request-id')).toBeTruthy();
    expect(allowed.includes('x-trace-id')).toBeTruthy();
    expect(allowed.includes('x-correlation-id')).toBeTruthy();
    expect(allowed.includes('x-webhook-signature')).toBeTruthy();
    expect(allowed.includes('x-api-key')).toBeTruthy();
  });
});

// ─── 5. Platform headers completeness ────────────────────────────────────────

describe('ALLOWED_HEADERS — completeness check', () => {
  const required = [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'X-Request-ID',
    'X-Trace-ID',
    'X-Correlation-ID',
    'Idempotency-Key',
    'X-MFA-Code',
    'X-Webhook-Signature',
    'X-API-Key',
  ];

  for (const header of required) {
    it(`includes ${header}`, () => {
      const lower = header.toLowerCase();
      const found = ALLOWED_HEADERS.some((h) => h.toLowerCase() === lower);
      expect(found).toBeTruthy();
    });
  }
});

describe('EXPOSED_HEADERS — completeness check', () => {
  const required = [
    'X-Total-Count',
    'X-Page',
    'X-Per-Page',
    'X-Request-ID',
    'X-Trace-ID',
    'X-Correlation-ID',
    'X-Cache',
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
  ];

  for (const header of required) {
    it(`includes ${header}`, () => {
      const lower = header.toLowerCase();
      const found = EXPOSED_HEADERS.some((h) => h.toLowerCase() === lower);
      expect(found).toBeTruthy();
    });
  }
});
