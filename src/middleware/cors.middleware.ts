/**
 * CORS Middleware — Hardened Origin Validation
 *
 * Security properties:
 *  1. Production guard: refuses to start if CORS_ORIGIN contains '*' in production.
 *  2. Exact-match: string origins are compared case-insensitively after normalisation.
 *  3. Regex/pattern support: origins prefixed with "regex:" are compiled to RegExp,
 *     enabling subdomain allowlisting (e.g. https://*.mentorminds.com).
 *  4. Non-matching origins receive a 403 response — not a silent no-CORS response.
 *  5. All platform custom headers are declared in allowedHeaders + exposedHeaders.
 *  6. Preflight cache duration is configurable via CORS_MAX_AGE (default: 86400 s).
 */

import cors, { CorsOptions } from 'cors';
import config from '../config';

// ---------------------------------------------------------------------------
// Platform headers — keep in sync with client SDK
// ---------------------------------------------------------------------------

/** Headers the browser is allowed to send (request headers). */
const ALLOWED_HEADERS: string[] = [
  // Standard
  'Content-Type',
  'Authorization',
  'X-Requested-With',
  // Tracing & correlation
  'X-Request-ID',
  'X-Trace-ID',
  'X-Correlation-ID',
  // Idempotency & MFA
  'Idempotency-Key',
  'X-MFA-Code',
  // Webhooks & API keys
  'X-Webhook-Signature',
  'X-API-Key',
];

/** Headers the browser JS is allowed to read from the response. */
const EXPOSED_HEADERS: string[] = [
  // Pagination
  'X-Total-Count',
  'X-Page',
  'X-Per-Page',
  // Tracing & correlation
  'X-Request-ID',
  'X-Trace-ID',
  'X-Correlation-ID',
  // API key passthrough
  'X-API-Key',
  // Cache indicators
  'X-Cache',
  // Rate-limit info
  'X-RateLimit-Limit',
  'X-RateLimit-Remaining',
];

// ---------------------------------------------------------------------------
// Production guard — fail-fast before any request is served
// ---------------------------------------------------------------------------

/**
 * Validates that the CORS configuration is safe for the current environment.
 * Kills the process immediately if a wildcard origin is detected in production.
 */
export function validateCorsForEnvironment(
  origins: string[],
  nodeEnv: string,
): void {
  const hasWildcard = origins.some((o) => o.trim() === '*');

  if (hasWildcard && nodeEnv === 'production') {
    process.stderr.write(
      '\n[FATAL] CORS misconfiguration: CORS_ORIGIN=* is not allowed in production.\n' +
        'Set CORS_ORIGIN to a comma-separated list of trusted origin URLs.\n' +
        'Example: CORS_ORIGIN=https://app.mentorminds.com,https://admin.mentorminds.com\n\n',
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Origin matching
// ---------------------------------------------------------------------------

/**
 * Converts a raw origin string from the CORS_ORIGIN env var into a matcher.
 *
 * Supported formats:
 *  - Bare wildcard:      "*"                              (allows all origins — dev only)
 *  - Plain URL:          "https://app.mentorminds.com"
 *  - Glob-style prefix:  "https://*.mentorminds.com"      (converted to a RegExp)
 *  - Explicit regex:     "regex:^https://[a-z]+-mentorminds\\.com$"
 */
function buildOriginMatcher(raw: string): string | RegExp {
  const trimmed = raw.trim();

  // Bare wildcard — keep as a plain string so isOriginAllowed can handle it
  // directly. validateCorsForEnvironment() prevents this reaching production.
  if (trimmed === '*') return '*';

  // Explicit regex prefix
  if (trimmed.startsWith('regex:')) {
    const pattern = trimmed.slice('regex:'.length);
    return new RegExp(pattern);
  }

  // Glob-style wildcard subdomain: https://*.example.com
  if (trimmed.includes('*')) {
    // 1. Escape all regex meta-characters EXCEPT '*'
    // 2. Replace '*' with '[^.]+' (subdomain segment, no dots allowed)
    // Anchor fully so injection attacks like "https://evil.com?x=https://a.mentorminds.com" don't match
    const escaped = trimmed
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape meta-chars (not *)
      .replace(/\*/g, '[^.]+');               // * → one subdomain segment
    return new RegExp(`^${escaped}$`);
  }

  return trimmed;
}

/** True when `origin` satisfies at least one entry in `matchers`. */
function isOriginAllowed(
  origin: string,
  matchers: ReadonlyArray<string | RegExp>,
): boolean {
  for (const matcher of matchers) {
    if (typeof matcher === 'string') {
      if (matcher === '*') return true;
      if (matcher.toLowerCase() === origin.toLowerCase()) return true;
    } else if (matcher.test(origin)) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

/**
 * Builds and returns an Express CORS middleware handler.
 *
 * Extracted as a factory so tests can inject custom configs without touching
 * module-level singletons.
 */
export function buildCorsMiddleware(options: {
  origins: string[];
  maxAge: number;
  nodeEnv: string;
}): ReturnType<typeof cors> {
  const { origins, maxAge, nodeEnv } = options;

  // Fail-fast in production with a wildcard
  validateCorsForEnvironment(origins, nodeEnv);

  const matchers = origins.map(buildOriginMatcher);

  const corsOptions: CorsOptions = {
    origin: (requestOrigin, callback) => {
      // Same-origin / server-to-server requests have no Origin header — allow.
      if (!requestOrigin) {
        return callback(null, true);
      }

      if (isOriginAllowed(requestOrigin, matchers)) {
        return callback(null, true);
      }

      // Return a proper error so the cors package emits a 403 (when
      // `cors` is used with the default error-forwarding behaviour of Express).
      const err = new Error(`CORS: origin '${requestOrigin}' is not allowed`) as Error & { status?: number };
      err.status = 403;
      return callback(err);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ALLOWED_HEADERS,
    exposedHeaders: EXPOSED_HEADERS,
    maxAge,
    // Respond to OPTIONS with 204 so browsers don't wait for a body.
    optionsSuccessStatus: 204,
  };

  return cors(corsOptions);
}

// ---------------------------------------------------------------------------
// Singleton middleware — used by app.ts
// ---------------------------------------------------------------------------

export const corsMiddleware = buildCorsMiddleware({
  origins: config.cors.origins,
  maxAge: config.cors.maxAge,
  nodeEnv: config.env,
});

// Re-export helpers for use in tests / other modules
export { ALLOWED_HEADERS, EXPOSED_HEADERS, isOriginAllowed, buildOriginMatcher };
